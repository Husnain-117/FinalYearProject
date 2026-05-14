"""
Simple helper to use the trained RoBERTa model for ticket classification.

This module:
- Loads the fine-tuned model from models/roberta_ticket_category
- Provides classify_ticket(text) -> category string

It is used by ticket_api.create_ticket to auto-set ticket.category.
"""

import os
from typing import List

# IMPORTANT: force Transformers to use only PyTorch (no TensorFlow/Keras)
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["USE_TF"] = "0"

# torch and transformers are imported lazily inside load_model_if_needed() so that
# this module can be imported in production where these heavy packages are not installed.

# Model directory (relative to clara-backend root)
MODEL_DIR = os.path.join("models", "roberta_ticket_category")

# Global variables for lazy loading
_tokenizer = None
_model = None
_label_classes: List[str] = []
_torch = None  # lazy reference set by load_model_if_needed()


def _load_label_classes(path: str) -> List[str]:
    """Load label classes (one label per line) from label_classes.txt."""
    classes = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                classes.append(line)
    return classes


def load_model_if_needed() -> None:
    """
    Load tokenizer, model, and labels once into memory.

    Called automatically by classify_ticket().
    """
    global _tokenizer, _model, _label_classes, _torch

    if _tokenizer is not None and _model is not None and _label_classes:
        return

    try:
        import torch as _t
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        _torch = _t
    except ImportError:
        # torch / transformers not installed (production) — caller uses fallback category
        return

    if not os.path.isdir(MODEL_DIR):
        raise RuntimeError(f"RoBERTa model directory not found: {MODEL_DIR}")

    # Load tokenizer and model
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    _model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    _model.eval()

    # Use GPU if available, otherwise CPU
    device = _torch.device("cuda" if _torch.cuda.is_available() else "cpu")
    _model.to(device)

    # Load label classes (index -> category string)
    classes_path = os.path.join(MODEL_DIR, "label_classes.txt")
    _label_classes = _load_label_classes(classes_path)


def classify_ticket(text: str) -> str:
    """Predict the ticket category for a given text.

    Returns a category string like "technical", "billing", etc.
    If anything goes wrong, returns "general" as a safe default.
    """
    result = classify_ticket_with_confidence(text)
    return result["category"]


def classify_ticket_with_confidence(text: str) -> dict:
    """
    Predict the ticket category and confidence for a given text.

    Returns a dict with:
    - category: string like "technical", "billing", etc.
    - confidence: float between 0 and 1
    """
    try:
        load_model_if_needed()
    except Exception:
        # If model is not available for any reason, fall back gracefully
        return {"category": "general", "confidence": 0.5}

    if _tokenizer is None or _model is None or not _label_classes or _torch is None:
        # torch / transformers not available in this environment — return safe default
        return {"category": "general", "confidence": 0.5}

    device = next(_model.parameters()).device

    # Tokenize input text
    inputs = _tokenizer(
        text,
        truncation=True,
        padding="max_length",
        max_length=128,
        return_tensors="pt",
    ).to(device)

    with _torch.no_grad():
        outputs = _model(**inputs)
        logits = outputs.logits
        
        # Apply softmax to get probabilities
        probabilities = _torch.nn.functional.softmax(logits, dim=-1)
        
        # Get the predicted class and its confidence
        confidence, predicted_idx = _torch.max(probabilities, dim=-1)
        predicted_idx = int(predicted_idx.item())
        confidence_score = float(confidence.item())

    if 0 <= predicted_idx < len(_label_classes):
        return {
            "category": _label_classes[predicted_idx],
            "confidence": confidence_score
        }

    return {"category": "general", "confidence": 0.5}
