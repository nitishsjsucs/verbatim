"""
Prompt loader for GOVINDA V2.

Loads YAML prompt templates from the config/prompts/ directory.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from config.settings import get_settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=32)
def load_prompt(category: str, name: str) -> dict[str, Any]:
    """
    Load a prompt template from config/prompts/{category}/{name}.yaml.

    Args:
        category: Subdirectory (e.g., "tree_building", "retrieval", "answering")
        name: Prompt name without extension (e.g., "toc_extraction")

    Returns:
        Dict containing the parsed YAML content.
    """
    settings = get_settings()
    prompt_path = settings.storage.prompts_dir / category / f"{name}.yaml"

    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt template not found: {prompt_path}")

    with open(prompt_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    logger.debug("Loaded prompt: %s/%s", category, name)
    return data


def get_prompt_text(category: str, name: str, key: str = "system") -> str:
    """
    Load a specific text field from a prompt template.

    Args:
        category: Subdirectory
        name: Prompt name
        key: Key in the YAML file (default: "system")

    Returns:
        The prompt text string.
    """
    data = load_prompt(category, name)
    text = data.get(key, "")
    if not text:
        raise KeyError(f"Key '{key}' not found in prompt {category}/{name}")
    return text


def format_prompt(template: str, **kwargs: Any) -> str:
    """
    Format a prompt template with variables.

    Uses Python str.format() with named placeholders.
    """
    try:
        return template.format(**kwargs)
    except KeyError as e:
        logger.warning("Missing prompt variable: %s", e)
        return template
