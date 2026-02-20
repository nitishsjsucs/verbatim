"""
LLM Client for GOVINDA V2 — Responses API only.

Simplified client focused on:
- Text generation with reasoning effort control
- JSON mode with robust extraction
- Token usage tracking

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


class LLMClient:
    """
    OpenAI Responses API client for GPT-5.2 / GPT-5.2 Pro.

    All LLM calls in GOVINDA V2 go through this client for
    centralized token tracking.
    """

    def __init__(self, api_key: Optional[str] = None) -> None:
        settings = get_settings()
        self._api_key = api_key or settings.llm.openai_api_key
        self._client = OpenAI(api_key=self._api_key, timeout=600.0)
        self._model = settings.llm.model
        self._model_pro = settings.llm.model_pro

        # Thread-safe usage tracking
        self._usage_lock = threading.Lock()
        self.total_input_tokens: int = 0
        self.total_output_tokens: int = 0
        self.total_calls: int = 0

    # ------------------------------------------------------------------
    # Usage tracking
    # ------------------------------------------------------------------

    def _track_usage(self, response: Any) -> tuple[int, int]:
        """Extract and accumulate token counts. Returns (input, output)."""
        usage = getattr(response, "usage", None)
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
        Send a Responses API request and return the response text.

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
            "LLM call: model=%s tokens=%d/%d latency=%.2fs effort=%s",
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
            "LLM call: model=%s tokens=%d/%d latency=%.2fs effort=%s truncated=%s",
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
