"""The AI tutor: optional, pluggable, and local by default.

satprep works completely without this. When it is switched on, it explains the
questions you got wrong using the question, your answer, and the official
rationale as context.

Every provider here except Anthropic speaks the OpenAI chat-completions shape,
which is the de-facto standard that LM Studio, Ollama, llama.cpp, vLLM, Jan,
LocalAI, OpenRouter, Groq and Together all implement. That means one code path
covers nearly everything, and "bring your own endpoint" is a first-class option
rather than a special case.

API keys live in ~/.config/satprep/config.json with 0600 permissions, never in
the database and never in the repository.
"""

import json
import os
import ssl
import urllib.error
import urllib.request

CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "satprep"
)
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

PROVIDERS = {
    "lmstudio": {
        "id": "lmstudio",
        "name": "LM Studio",
        "kind": "local",
        "base_url": "http://localhost:1234/v1",
        "needs_key": False,
        "setup": "Open LM Studio, load a model, and start the local server "
                 "(Developer tab -> Start Server).",
        "notes": "Easiest local option: a GUI model browser, automatic GPU "
                 "offload, and an OpenAI-compatible server built in.",
    },
    "ollama": {
        "id": "ollama",
        "name": "Ollama",
        "kind": "local",
        "base_url": "http://localhost:11434/v1",
        "needs_key": False,
        "setup": "Install Ollama, then `ollama pull qwen2.5:7b-instruct`. "
                 "The server runs automatically on port 11434.",
        "notes": "Simplest command line workflow. Models are pulled by name "
                 "and served without further configuration.",
    },
    "llamacpp": {
        "id": "llamacpp",
        "name": "llama.cpp server",
        "kind": "local",
        "base_url": "http://localhost:8080/v1",
        "needs_key": False,
        "setup": "Run `llama-server -m model.gguf -c 8192 -ngl 99`.",
        "notes": "Most control over quantisation, context length and GPU "
                 "layer offload. Best raw performance per gigabyte of VRAM.",
    },
    "custom": {
        "id": "custom",
        "name": "Custom OpenAI-compatible endpoint",
        "kind": "either",
        "base_url": "",
        "needs_key": False,
        "setup": "Point this at any server implementing /v1/chat/completions: "
                 "vLLM, Jan, LocalAI, text-generation-webui, OpenRouter, "
                 "Groq, Together, or a self-hosted gateway.",
        "notes": "The escape hatch. If it speaks the OpenAI API, it works.",
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "kind": "external",
        "base_url": "https://api.openai.com/v1",
        "needs_key": True,
        "setup": "Set an API key from platform.openai.com.",
        "notes": "External service: your questions and answers leave your "
                 "machine and you pay per token.",
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic",
        "kind": "external",
        "base_url": "https://api.anthropic.com/v1",
        "needs_key": True,
        "setup": "Set an API key from console.anthropic.com.",
        "notes": "External service: your questions and answers leave your "
                 "machine and you pay per token. Strong at explaining "
                 "reasoning step by step.",
    },
}

# ---------------------------------------------------------------------------
# Model guidance
# ---------------------------------------------------------------------------
# Sizes assume Q4_K_M GGUF, which is roughly 0.6 GB per billion parameters.
# `vram_gb` is the model weights plus a working context; leave ~1 GB headroom.
#
# This is guidance for choosing what to download, not a hard-coded list of what
# you can run -- the app also asks your provider what it actually has loaded.

MODEL_GUIDE = [
    {
        "name": "Qwen2.5 7B Instruct",
        "params": "7B",
        "vram_gb": 5.5,
        "best_for": "All-round default",
        "pros": [
            "Strongest maths of the common 7B models, which is where SAT tutoring hurts most",
            "Follows 'explain, do not just answer' instructions reliably",
            "Comfortable fit on 8 GB with room for a long passage in context",
        ],
        "cons": [
            "Prose explanations are competent but drier than larger models",
        ],
        "pull": "ollama pull qwen2.5:7b-instruct",
    },
    {
        "name": "Llama 3.1 8B Instruct",
        "params": "8B",
        "vram_gb": 6.0,
        "best_for": "Reading and Writing explanations",
        "pros": [
            "Clear, natural explanations of grammar and rhetoric questions",
            "Very widely supported, so quantisations and fixes appear early",
        ],
        "cons": [
            "Noticeably weaker at multi-step algebra than Qwen2.5",
            "Will sometimes assert a wrong maths answer confidently",
        ],
        "pull": "ollama pull llama3.1:8b-instruct-q4_K_M",
    },
    {
        "name": "DeepSeek-R1-Distill-Qwen 7B",
        "params": "7B",
        "vram_gb": 5.5,
        "best_for": "Hard maths, when you can wait",
        "pros": [
            "Reasons step by step before answering, which catches its own errors",
            "Best accuracy in this size class on multi-step problems",
        ],
        "cons": [
            "Much slower: it writes a long private chain of thought first",
            "Overkill for grammar questions, and rambles on easy ones",
        ],
        "pull": "ollama pull deepseek-r1:7b",
    },
    {
        "name": "Gemma 2 9B Instruct",
        "params": "9B",
        "vram_gb": 6.8,
        "best_for": "Explaining passages in plain language",
        "pros": [
            "Best writing quality of the models that fit in 8 GB",
            "Good at paraphrasing a dense passage into something readable",
        ],
        "cons": [
            "Tight on 8 GB: shorten context or expect some CPU spill",
            "Weaker maths than Qwen2.5 7B despite being larger",
        ],
        "pull": "ollama pull gemma2:9b-instruct-q4_K_M",
    },
    {
        "name": "Qwen2.5 3B Instruct",
        "params": "3B",
        "vram_gb": 2.6,
        "best_for": "Old or shared GPUs, instant replies",
        "pros": [
            "Very fast, leaves most of the GPU free",
            "Runs acceptably on CPU alone if you have no usable GPU",
        ],
        "cons": [
            "Makes real mathematical mistakes; treat maths output as a hint",
            "Do not rely on it to arbitrate between two answer choices",
        ],
        "pull": "ollama pull qwen2.5:3b-instruct",
    },
    {
        "name": "Phi-4 14B",
        "params": "14B",
        "vram_gb": 9.5,
        "best_for": "Maths accuracy if you have 12 GB or more",
        "pros": [
            "Markedly better at multi-step maths than any 7-9B option",
        ],
        "cons": [
            "Does not fit in 8 GB: layers spill to system RAM and it crawls",
            "Only worth it on a 12 GB or larger card",
        ],
        "pull": "ollama pull phi4:14b",
    },
]


def guidance_for(vram_gb):
    """Tag each model as fits / tight / too big for the detected GPU."""
    out = []
    for m in MODEL_GUIDE:
        entry = dict(m)
        if vram_gb is None:
            entry["fit"] = "unknown"
        elif m["vram_gb"] <= vram_gb - 1.0:
            entry["fit"] = "fits"
        elif m["vram_gb"] <= vram_gb + 0.5:
            entry["fit"] = "tight"
        else:
            entry["fit"] = "too_big"
        out.append(entry)
    return out


def detect_vram_gb():
    """Total VRAM of the first NVIDIA GPU, or None if we cannot tell."""
    import shutil
    import subprocess

    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=8,
        )
        return round(int(out.stdout.strip().splitlines()[0]) / 1024, 1)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "enabled": False,
    "provider": "lmstudio",
    "model": "",
    "base_url": "",
    "api_key": "",
    "temperature": 0.3,
    "max_tokens": 700,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH) as fh:
            cfg.update(json.load(fh))
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return cfg


def save_config(update):
    cfg = load_config()
    cfg.update(update)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    # Written 0600 first, then filled: the key is never briefly world-readable.
    fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(cfg, fh, indent=2)
    return cfg


def public_config():
    """Config for the UI, with the API key reduced to a boolean."""
    cfg = load_config()
    cfg = dict(cfg)
    cfg["has_key"] = bool(cfg.pop("api_key", ""))
    return cfg


def resolve_endpoint(cfg):
    provider = PROVIDERS.get(cfg.get("provider"), PROVIDERS["lmstudio"])
    base = (cfg.get("base_url") or provider["base_url"] or "").rstrip("/")
    if not base:
        raise TutorError("No endpoint configured for this provider.")
    return provider, base


class TutorError(Exception):
    pass


# ---------------------------------------------------------------------------
# Talking to the model
# ---------------------------------------------------------------------------

def _http(url, payload=None, headers=None, timeout=180, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers=headers or {}, method=method or ("POST" if data else "GET")
    )
    ctx = ssl.create_default_context()
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:400]
        raise TutorError(f"HTTP {e.code} from {url}: {body}") from e
    except urllib.error.URLError as e:
        raise TutorError(
            f"Could not reach {url}. Is the model server running? ({e.reason})"
        ) from e


def list_models(cfg=None):
    """Ask the configured provider what it actually has available."""
    cfg = cfg or load_config()
    provider, base = resolve_endpoint(cfg)

    if provider["id"] == "anthropic":
        # Anthropic has a models endpoint but it needs a key; skip the probe.
        return []

    headers = {"Accept": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    with _http(f"{base}/models", None, headers, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    return [m.get("id") for m in data.get("data", []) if m.get("id")]


def health(cfg=None):
    """Is the tutor usable right now? Returns a dict the UI can render."""
    cfg = cfg or load_config()
    provider = PROVIDERS.get(cfg.get("provider"), {})
    try:
        models = list_models(cfg)
        return {
            "ok": True,
            "provider": provider.get("name"),
            "models": models,
            "model": cfg.get("model"),
            "warning": (
                "No model selected yet." if not cfg.get("model")
                else "" if (not models or cfg["model"] in models)
                else f"'{cfg['model']}' is not in the server's model list."
            ),
        }
    except TutorError as e:
        return {"ok": False, "provider": provider.get("name"), "error": str(e),
                "setup": provider.get("setup", "")}


def _messages_for(question, detail, user_response, mode):
    """Build the prompt. The official rationale is given as ground truth."""
    opts = "\n".join(
        f"  {o['letter']}. {_strip(o['content'])}" for o in question.get("options", [])
    )
    key = ", ".join(str(k) for k in detail.get("correct_answer", []))
    rationale = _strip(detail.get("rationale") or "")

    context = [
        f"Section: {question.get('test_name')}",
        f"Domain: {question.get('domain')} / Skill: {question.get('skill')}",
        f"Difficulty: {question.get('difficulty')}",
    ]
    if question.get("stimulus"):
        context.append(f"\nPassage:\n{_strip(question['stimulus'])}")
    context.append(f"\nQuestion:\n{_strip(question.get('stem') or '')}")
    if opts:
        context.append(f"\nChoices:\n{opts}")
    context.append(f"\nCorrect answer: {key}")
    if rationale:
        context.append(f"\nOfficial explanation:\n{rationale}")
    if user_response:
        context.append(f"\nThe student answered: {user_response}")

    system = (
        "You are an SAT tutor. You are given a real SAT question, its correct "
        "answer, and the official explanation. The official explanation is "
        "ground truth: never contradict it, and never claim a different answer "
        "is correct.\n\n"
        "Your job is to make the student able to solve the NEXT question like "
        "this one, not to restate the official explanation. Be concise and "
        "concrete. Keep it under 200 words unless asked for more.\n\n"
        "Formatting rules, which matter because your reply is shown as plain "
        "text in a study app:\n"
        "- No markdown. No **asterisks**, no ##headings, no bullet syntax.\n"
        "- No LaTeX. Never write \\( \\), \\[ \\], $...$ or \\frac. Write maths "
        "the way you would type it in a message: y = 15w^2, (x+3)/2, sqrt(5).\n"
        "- Write in short paragraphs separated by a blank line."
    )

    if mode == "why_wrong" and user_response:
        ask = (
            f"The student picked {user_response}, which is wrong. Explain in two "
            "parts: (1) the specific trap that makes their choice tempting, and "
            "(2) the reliable method that gets the right answer, phrased as "
            "something they can repeat on a similar question."
        )
    elif mode == "hint":
        ask = (
            "Give a single hint that points at the first step, without revealing "
            "the answer or naming a choice."
        )
    else:
        ask = (
            "Explain how to solve this question in a way that generalises to "
            "similar ones. Name the underlying skill being tested."
        )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(context) + "\n\n---\n" + ask},
    ]


def _strip(html_text):
    """Crude HTML/MathML to text. Models handle the residue fine."""
    import html as htmlmod
    import re

    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html_text or "", flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = htmlmod.unescape(text)
    return re.sub(r"[ \t]+", " ", text).strip()


def stream_explanation(question, detail, user_response=None, mode="why_wrong", cfg=None):
    """Yield explanation text chunks as the model produces them."""
    cfg = cfg or load_config()
    if not cfg.get("enabled"):
        raise TutorError("The tutor is switched off. Enable it in Settings.")
    if not cfg.get("model"):
        raise TutorError("No model selected. Pick one in Settings.")

    provider, base = resolve_endpoint(cfg)
    messages = _messages_for(question, detail, user_response, mode)

    if provider["id"] == "anthropic":
        yield from _stream_anthropic(base, cfg, messages)
    else:
        yield from _stream_openai(base, cfg, messages)


def _stream_openai(base, cfg, messages):
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    payload = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": cfg.get("temperature", 0.3),
        "max_tokens": cfg.get("max_tokens", 700),
        "stream": True,
    }
    with _http(f"{base}/chat/completions", payload, headers) as resp:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            body = line[5:].strip()
            if body == "[DONE]":
                return
            try:
                delta = json.loads(body)["choices"][0].get("delta", {})
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
            if delta.get("content"):
                yield delta["content"]


def _stream_anthropic(base, cfg, messages):
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    payload = {
        "model": cfg["model"],
        "system": system,
        "messages": [m for m in messages if m["role"] != "system"],
        "max_tokens": cfg.get("max_tokens", 700),
        "temperature": cfg.get("temperature", 0.3),
        "stream": True,
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": cfg.get("api_key", ""),
        "anthropic-version": "2023-06-01",
    }
    with _http(f"{base}/messages", payload, headers) as resp:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if event.get("type") == "content_block_delta":
                text = event.get("delta", {}).get("text")
                if text:
                    yield text
            elif event.get("type") == "message_stop":
                return
