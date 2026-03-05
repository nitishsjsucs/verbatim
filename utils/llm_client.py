"""
LLM Client for GOVINDA V2 — Multi-provider (OpenAI Responses + DeepInfra Chat Completions).

Simplified client focused on:
- Text generation with reasoning effort control
- JSON mode with robust extraction
- Token usage tracking
- Provider-aware routing: OpenAI models use Responses API,
  DeepInfra models use Chat Completions API.

No tool/function calling needed — retrieval is LLM-as-reasoner over trees,
not agent-with-tools.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Optional

from openai import APITimeoutError, OpenAI, RateLimitError

from config.settings import get_settings

logger = logging.getLogger(__name__)


# ─── Provider Registry ────────────────────────────────────────────────────────
# Models whose IDs contain a slash (e.g. "zai-org/GLM-5") or match known
# DeepInfra prefixes are routed to the DeepInfra Chat Completions API.
# Everything else goes to the native OpenAI Responses API.

DEEPINFRA_MODEL_PREFIXES = (
    "zai-org/",
    "deepseek-ai/",
    "Qwen/",
    "mistralai/",
    "moonshotai/",
)


def is_deepinfra_model(model_id: str) -> bool:
    """Return True if *model_id* should be routed to DeepInfra."""
    if any(model_id.startswith(p) for p in DEEPINFRA_MODEL_PREFIXES):
        return True
    # Generic heuristic: org/model format → DeepInfra
    if "/" in model_id and not model_id.startswith("gpt-"):
        return True
    return False


class LLMClient:
    """
    Multi-provider LLM client for GOVINDA V2.

    - OpenAI models (gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano):
      Use the native OpenAI Responses API.
    - DeepInfra models (GLM-5, DeepSeek-V3, Qwen, etc.):
      Use the OpenAI-compatible Chat Completions API via DeepInfra.

    All LLM calls in GOVINDA V2 go through this client for
    centralized token tracking.
    """

    def __init__(self, api_key: Optional[str] = None) -> None:
        settings = get_settings()
        self._api_key = api_key or settings.llm.openai_api_key
        self._client = OpenAI(api_key=self._api_key, timeout=600.0)
        self._model = settings.llm.model
        self._model_pro = settings.llm.model_pro

        # DeepInfra client (lazy — only created when needed)
        self._deepinfra_client: Optional[OpenAI] = None
        self._deepinfra_api_key = settings.llm.deepinfra_api_key
        self._deepinfra_base_url = settings.llm.deepinfra_base_url

        # Thread-safe usage tracking
        self._usage_lock = threading.Lock()
        self.total_input_tokens: int = 0
        self.total_output_tokens: int = 0
        self.total_calls: int = 0

    # ------------------------------------------------------------------
    # Usage tracking
    # ------------------------------------------------------------------

    def _get_deepinfra_client(self) -> OpenAI:
        """Lazy-init and return the DeepInfra OpenAI-compatible client."""
        if self._deepinfra_client is None:
            if not self._deepinfra_api_key:
                raise ValueError(
                    "DEEPINFRA_API_KEY is not set. Add it to your .env file."
                )
            self._deepinfra_client = OpenAI(
                api_key=self._deepinfra_api_key,
                base_url=self._deepinfra_base_url,
                timeout=600.0,
            )
        return self._deepinfra_client

    def _track_usage(self, response: Any, *, chat_completions: bool = False) -> tuple[int, int]:
        """Extract and accumulate token counts. Returns (input, output)."""
        usage = getattr(response, "usage", None)
        if chat_completions:
            # Chat Completions API uses prompt_tokens / completion_tokens
            inp = getattr(usage, "prompt_tokens", 0) if usage else 0
            out = getattr(usage, "completion_tokens", 0) if usage else 0
        else:
            # Responses API uses input_tokens / output_tokens
            inp = getattr(usage, "input_tokens", 0) if usage else 0
            out = getattr(usage, "output_tokens", 0) if usage else 0
        with self._usage_lock:
            self.total_input_tokens += inp
            self.total_output_tokens += out
            self.total_calls += 1
        return inp, out

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    def reset_usage(self) -> None:
        with self._usage_lock:
            self.total_input_tokens = 0
            self.total_output_tokens = 0
            self.total_calls = 0

    def get_usage_summary(self) -> dict[str, int]:
        with self._usage_lock:
            return {
                "total_calls": self.total_calls,
                "total_input_tokens": self.total_input_tokens,
                "total_output_tokens": self.total_output_tokens,
                "total_tokens": self.total_tokens,
            }

    # ------------------------------------------------------------------
    # DeepInfra Chat Completions path
    # ------------------------------------------------------------------

    def _chat_deepinfra(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: Optional[float],
        max_tokens: int,
        json_mode: bool,
        reasoning_effort: Optional[str],
    ) -> tuple[str, int, int, float, str, bool]:
        """
        Call DeepInfra via the OpenAI Chat Completions API.

        All DeepInfra models accept these params per their API schema:
          - model, messages, max_tokens          (required/basic)
          - temperature                          (default 1)
          - reasoning_effort                     (enum: none/low/medium/high)
          - response_format                      (json_object, json_schema, text, regex)

        Returns:
            (content, input_tokens, output_tokens, elapsed, effort, was_truncated)
        """
        client = self._get_deepinfra_client()
        settings = get_settings()

        # Clamp reasoning_effort to DeepInfra's accepted values: none/low/medium/high
        effort = reasoning_effort or "none"
        if effort == "xhigh":
            effort = "high"
        if effort == "minimal":
            effort = "low"

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }

        # reasoning_effort — all DeepInfra models accept this per their API schema
        if effort and effort != "none":
            kwargs["reasoning_effort"] = effort

        # temperature — all DeepInfra models accept this (default: 1)
        if temperature is not None:
            kwargs["temperature"] = temperature

        # response_format — all DeepInfra models accept json_object
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        logger.debug(
            "DeepInfra request: model=%s effort=%s temp=%s json=%s max_tokens=%d",
            model, effort, temperature, json_mode, max_tokens,
        )

        start = time.time()
        response = client.chat.completions.create(**kwargs)
        elapsed = time.time() - start

        inp, out = self._track_usage(response, chat_completions=True)

        # Extract content
        content = ""
        if response.choices:
            msg = response.choices[0].message
            content = msg.content or ""
            # Some reasoning models put chain-of-thought in reasoning_content
            # and the final answer in content. If content is empty, fall back.
            if not content.strip():
                reasoning_content = getattr(msg, "reasoning_content", None) or ""
                if reasoning_content.strip():
                    logger.info(
                        "DeepInfra %s: content empty, using reasoning_content (%d chars)",
                        model, len(reasoning_content),
                    )
                    content = reasoning_content
            if not content.strip():
                logger.warning(
                    "DeepInfra %s: empty response. finish_reason=%s, tokens=%d/%d",
                    model,
                    response.choices[0].finish_reason,
                    inp, out,
                )

        # Strip <think>...</think> chain-of-thought blocks (e.g. DeepSeek-R1)
        if "<think>" in content:
            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

        # Detect truncation via finish_reason
        was_truncated = (
            response.choices[0].finish_reason == "length"
            if response.choices
            else False
        )

        return content, inp, out, elapsed, effort, was_truncated

    # ------------------------------------------------------------------
    # Core text generation
    # ------------------------------------------------------------------

    def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
        reasoning_effort: Optional[str] = None,
    ) -> str:
        """
        Send an LLM request and return the response text.

        Automatically routes to the correct provider:
        - OpenAI models → Responses API
        - DeepInfra models → Chat Completions API

        Args:
            messages: List of {"role": ..., "content": ...} dicts.
            model: Override model (defaults to gpt-5.2).
            temperature: Override temperature. Only effective when
                         reasoning_effort is "none".
            max_tokens: Override max_output_tokens.
            json_mode: If True, request JSON response format.
            reasoning_effort: "none" | "low" | "medium" | "high" | "xhigh".
                              Defaults to "none" for gpt-5.2,
                              "medium" for gpt-5.2-pro.

        Returns:
            The assistant's response text.
        """
        settings = get_settings()
        model = model or self._model
        max_tokens = max_tokens or settings.llm.max_tokens_default

        # ── DeepInfra path ────────────────────────────────────────────
        if is_deepinfra_model(model):
            content, inp, out, elapsed, effort, _ = self._chat_deepinfra(
                messages, model, temperature, max_tokens, json_mode, reasoning_effort,
            )
            logger.debug(
                "LLM call [deepinfra]: model=%s tokens=%d/%d latency=%.2fs effort=%s",
                model, inp, out, elapsed, effort,
            )
            return content

        # ── OpenAI Responses API path ─────────────────────────────────
        kwargs: dict[str, Any] = {
            "model": model,
            "input": messages,
            "max_output_tokens": max_tokens,
            "store": False,
        }

        # Reasoning effort defaults
        if reasoning_effort:
            effort = reasoning_effort
        elif model == self._model_pro:
            effort = "medium"
        else:
            effort = "none"
        # Guard: only gpt-5.2 base supports effort="none".
        # Mini / nano / pro require at minimum "low".
        if effort == "none" and model != self._model:
            effort = "low"

        kwargs["reasoning"] = {"effort": effort}

        # Temperature only works with reasoning_effort="none"
        if effort == "none":
            temp = temperature if temperature is not None else settings.llm.temperature
            kwargs["temperature"] = temp

        # JSON mode
        if json_mode:
            kwargs["text"] = {"format": {"type": "json_object"}}

        start = time.time()
        response = self._client.responses.create(**kwargs)
        elapsed = time.time() - start

        inp, out = self._track_usage(response)
        content = response.output_text or ""

        logger.debug(
            "LLM call [openai]: model=%s tokens=%d/%d latency=%.2fs effort=%s",
            model,
            inp,
            out,
            elapsed,
            effort,
        )

        return content

    def chat_with_status(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
        reasoning_effort: Optional[str] = None,
    ) -> tuple[str, bool]:
        """
        Same as chat() but also returns whether the response was truncated.

        Returns:
            Tuple of (response_text, was_truncated).
            was_truncated is True when the API stopped due to max_output_tokens.
        """
        settings = get_settings()
        model = model or self._model
        max_tokens = max_tokens or settings.llm.max_tokens_default

        # ── DeepInfra path ────────────────────────────────────────────
        if is_deepinfra_model(model):
            content, inp, out, elapsed, effort, was_truncated = self._chat_deepinfra(
                messages, model, temperature, max_tokens, json_mode, reasoning_effort,
            )
            logger.debug(
                "LLM call [deepinfra]: model=%s tokens=%d/%d latency=%.2fs effort=%s truncated=%s",
                model, inp, out, elapsed, effort, was_truncated,
            )
            return content, was_truncated

        # ── OpenAI Responses API path ─────────────────────────────────
        kwargs: dict[str, Any] = {
            "model": model,
            "input": messages,
            "max_output_tokens": max_tokens,
            "store": False,
        }

        # Reasoning effort defaults
        if reasoning_effort:
            effort = reasoning_effort
        elif model == self._model_pro:
            effort = "medium"
        else:
            effort = "none"
        # Guard: only gpt-5.2 base supports effort="none".
        # Mini / nano / pro require at minimum "low".
        if effort == "none" and model != self._model:
            effort = "low"

        kwargs["reasoning"] = {"effort": effort}

        # Temperature only works with reasoning_effort="none"
        if effort == "none":
            temp = temperature if temperature is not None else settings.llm.temperature
            kwargs["temperature"] = temp

        # JSON mode
        if json_mode:
            kwargs["text"] = {"format": {"type": "json_object"}}

        start = time.time()
        response = self._client.responses.create(**kwargs)
        elapsed = time.time() - start

        inp, out = self._track_usage(response)
        content = response.output_text or ""

        # Detect truncation via API status
        was_truncated = getattr(response, "status", "") == "incomplete"

        logger.debug(
            "LLM call [openai]: model=%s tokens=%d/%d latency=%.2fs effort=%s truncated=%s",
            model,
            inp,
            out,
            elapsed,
            effort,
            was_truncated,
        )

        return content, was_truncated

    def chat_pro(
        self,
        messages: list[dict[str, str]],
        max_tokens: Optional[int] = None,
        json_mode: bool = False,
        reasoning_effort: str = "medium",
    ) -> str:
        """Chat using GPT-5.2 Pro (deeper reasoning for synthesis)."""
        return self.chat(
            messages=messages,
            model=self._model_pro,
            max_tokens=max_tokens,
            json_mode=json_mode,
            reasoning_effort=reasoning_effort,
        )

    # ------------------------------------------------------------------
    # JSON extraction with multi-fallback
    # ------------------------------------------------------------------

    def chat_json(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        retries: int = 3,
        reasoning_effort: Optional[str] = None,
    ) -> dict | list:
        """
        Chat and extract JSON from the response with multi-fallback.

        Strategies:
        1. Direct json.loads on json_mode response
        2. Code block extraction (```json ... ```)
        3. Balanced brace/bracket extraction
        4. Retry without json_mode as final fallback
        """
        last_error: Exception | None = None
        content = ""

        for attempt in range(retries):
            try:
                content = self.chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_mode=True,
                    reasoning_effort=reasoning_effort,
                )
                if len(content.strip()) < 3:
                    raise ValueError(
                        f"LLM returned empty/trivial response (len={len(content.strip())})"
                    )
                return self._ensure_dict_or_list(self._extract_json(content))
            except (json.JSONDecodeError, ValueError) as e:
                last_error = e
                logger.warning(
                    "JSON parse attempt %d/%d failed: %s",
                    attempt + 1,
                    retries,
                    str(e)[:120],
                )
            except (APITimeoutError, RateLimitError) as e:
                last_error = e
                logger.warning(
                    "API error on attempt %d/%d: %s",
                    attempt + 1,
                    retries,
                    str(e)[:120],
                )
                if isinstance(e, RateLimitError):
                    time.sleep(2**attempt)

        # Final fallback: try without json_mode
        try:
            content = self.chat(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                json_mode=False,
                reasoning_effort=reasoning_effort,
            )
            if len(content.strip()) >= 3:
                return self._ensure_dict_or_list(self._extract_json(content))
        except (json.JSONDecodeError, ValueError, APITimeoutError, RateLimitError):
            pass

        logger.error("All JSON parse attempts failed")
        raise last_error or ValueError("Failed to extract JSON after all retries")

    def chat_json_with_status(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> tuple[dict | list, bool]:
        """
        Chat and extract JSON, also returning truncation status.

        Unlike chat_json(), this does NOT retry on truncation — it returns
        whatever JSON it can salvage plus a was_truncated flag so the caller
        can decide how to continue.

        Returns:
            Tuple of (parsed_json, was_truncated).
        """
        content, was_truncated = self.chat_with_status(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            reasoning_effort=reasoning_effort,
        )

        if len(content.strip()) < 3:
            raise ValueError(
                f"LLM returned empty/trivial response (len={len(content.strip())})"
            )

        # If truncated, the JSON is likely incomplete. Try to salvage what we can.
        if was_truncated:
            logger.warning(
                "Response was truncated (max_output_tokens). Attempting JSON salvage..."
            )
            try:
                result = self._extract_json(content)
                return self._ensure_dict_or_list(result), True
            except (json.JSONDecodeError, ValueError):
                # JSON is broken due to truncation. Try to repair by closing
                # the answer_text field and the outer object.
                repaired = self._repair_truncated_json(content)
                if repaired is not None:
                    return self._ensure_dict_or_list(repaired), True
                # Last resort: wrap raw text
                logger.warning("Could not salvage truncated JSON, wrapping raw text")
                return {
                    "answer_text": content,
                    "citations": [],
                    "inferred_points": [],
                }, True

        # Normal (non-truncated) path
        return self._ensure_dict_or_list(self._extract_json(content)), False

    @staticmethod
    def _repair_truncated_json(text: str) -> dict | None:
        """
        Attempt to repair a JSON object that was truncated mid-stream.

        Strategy: find the answer_text value and close the JSON minimally.
        """
        text = text.strip()

        # Find the start of the JSON object
        obj_start = text.find("{")
        if obj_start == -1:
            return None

        # Try progressively aggressive truncation points
        # 1) Find the last complete key-value pair boundary
        # Look for the last complete string value ending with ","
        for try_end in range(len(text) - 1, obj_start, -1):
            candidate = text[obj_start : try_end + 1]
            # Try closing with }}
            for closer in ["}", '"}', '"]}', '""]}', '": []}']:
                attempt = candidate + closer
                # Clean up trailing commas
                attempt = re.sub(r",\s*([}\]])", r"\1", attempt)
                try:
                    result = json.loads(attempt)
                    if isinstance(result, dict) and "answer_text" in result:
                        return result
                except json.JSONDecodeError:
                    continue

            # Don't search too far back — limit to last 200 chars
            if len(text) - try_end > 200:
                break

        return None

    @staticmethod
    def _extract_json(text: str) -> dict | list:
        """Extract JSON from LLM response text with multiple fallbacks."""
        text = text.strip()

        # Strategy 1: Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Strategy 2: Code block extraction
        code_block = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
        if code_block:
            try:
                return json.loads(code_block.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Strategy 3: Balanced brace/bracket extraction
        for open_c, close_c in [("{", "}"), ("[", "]")]:
            start = text.find(open_c)
            if start == -1:
                continue

            depth = 0
            in_string = False
            escape = False

            for i in range(start, len(text)):
                c = text[i]
                if escape:
                    escape = False
                    continue
                if c == "\\":
                    escape = True
                    continue
                if c == '"' and not escape:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if c == open_c:
                    depth += 1
                elif c == close_c:
                    depth -= 1
                    if depth == 0:
                        candidate = text[start : i + 1]
                        candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
                        candidate = re.sub(r"//.*?\n", "\n", candidate)
                        try:
                            return json.loads(candidate)
                        except json.JSONDecodeError:
                            break

        raise ValueError(f"Could not extract JSON from: {text[:200]}...")

    @staticmethod
    def _ensure_dict_or_list(result: Any) -> dict | list:
        """Guarantee return type is dict or list."""
        if isinstance(result, (dict, list)):
            return result
        return {"value": result}
