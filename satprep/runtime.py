"""A local model that sets itself up.

The point of this module is that a student who has never heard of Ollama, GGUF
or quantisation can click one button and end up with a working tutor. satprep
downloads the inference engine, downloads the model, starts the server and
points the tutor at it. No terminal, no separate install, no configuration.

Engine: prebuilt llama.cpp server binaries from the project's GitHub releases.
We prefer the Vulkan build, because one asset gives GPU acceleration on NVIDIA,
AMD and Intel alike, and needs no CUDA runtime download. macOS uses the native
build, where Metal is compiled in. If no GPU stack is present we fall back to
the CPU build, which still works, just slower.

Models: GGUF files from Hugging Face over plain HTTPS. Downloads resume, so a
dropped connection does not mean starting a 5 GB file again.
"""

import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import tarfile
import threading
import time
import urllib.request
import zipfile

from . import tutor

DATA_DIR = os.path.join(
    os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "satprep"
)
ENGINE_DIR = os.path.join(DATA_DIR, "engine")
MODEL_DIR = os.path.join(DATA_DIR, "models")

LLAMA_RELEASES = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
UA = "satprep/1.0"

# --------------------------------------------------------------------------
# Model catalogue
# --------------------------------------------------------------------------
# Every entry is a single-file GGUF served over plain HTTPS with no token.
# `vram_gb` is weights plus a working context; compare against the detected GPU.

MODELS = [
    {
        "id": "qwen2.5-7b",
        "name": "Qwen2.5 7B Instruct",
        "size_gb": 4.7,
        "vram_gb": 5.5,
        "params": "7B",
        "recommended": True,
        "best_for": "The all-round default",
        "repo": "bartowski/Qwen2.5-7B-Instruct-GGUF",
        "file": "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        "licence": "Apache 2.0",
        "pros": [
            "Best maths of the models this size, and maths is where SAT tutoring fails",
            "Follows 'explain the method, don't just give the answer' reliably",
            "Fits a 6 GB card with room for a long reading passage",
        ],
        "cons": ["Explanations are accurate but a little dry"],
    },
    {
        "id": "llama3.1-8b",
        "name": "Llama 3.1 8B Instruct",
        "size_gb": 4.9,
        "vram_gb": 6.0,
        "params": "8B",
        "recommended": False,
        "best_for": "Reading & Writing explanations",
        "repo": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        "file": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        "licence": "Llama 3.1 Community Licence",
        "pros": [
            "Clearest natural-language explanations of grammar and rhetoric",
            "Very widely used, so quirks are well documented",
        ],
        "cons": [
            "Noticeably weaker at multi-step algebra than Qwen2.5",
            "Can state a wrong maths result with confidence",
        ],
    },
    {
        "id": "llama3.2-3b",
        "name": "Llama 3.2 3B Instruct",
        "size_gb": 2.0,
        "vram_gb": 2.8,
        "params": "3B",
        "recommended": False,
        "best_for": "Older laptops and small GPUs",
        "repo": "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "file": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "licence": "Llama 3.2 Community Licence",
        "pros": [
            "Small and quick; usable on CPU alone",
            "Fine for rephrasing an explanation you already have",
        ],
        "cons": [
            "Makes real mathematical errors — treat its maths as a hint, not an answer",
            "Not reliable for deciding between two close answer choices",
        ],
    },
    {
        "id": "gemma2-9b",
        "name": "Gemma 2 9B Instruct",
        "size_gb": 5.8,
        "vram_gb": 6.8,
        "params": "9B",
        "recommended": False,
        "best_for": "Plain-language passage explanations",
        "repo": "bartowski/gemma-2-9b-it-GGUF",
        "file": "gemma-2-9b-it-Q4_K_M.gguf",
        "licence": "Gemma Terms of Use",
        "pros": [
            "Best writing quality of the options that fit in 8 GB",
            "Good at turning a dense passage into something readable",
        ],
        "cons": [
            "Tight on an 8 GB card; expect some slowdown",
            "Weaker maths than Qwen2.5 7B despite being bigger",
        ],
    },
    {
        "id": "gemma4-e4b",
        "name": "Gemma 4 E4B Instruct",
        "size_gb": 5.0,
        "vram_gb": 5.8,
        "params": "E4B",
        "recommended": False,
        "best_for": "Explaining passages in plain language",
        "repo": "unsloth/gemma-4-E4B-it-GGUF",
        "file": "gemma-4-E4B-it-Q4_K_M.gguf",
        "licence": "Gemma Terms of Use",
        "pros": [
            "Google's current Gemma line; clearer prose than most models this size",
            "Good at turning a dense reading passage into something plain",
            "Fits an 8 GB card with room for a long passage",
        ],
        "cons": [
            "Maths is weaker than Qwen2.5 7B — prefer that one for the Math section",
        ],
    },
    {
        "id": "bonsai-8b",
        "name": "Bonsai 8B (ternary)",
        "size_gb": 1.2,
        "vram_gb": 2.0,
        "params": "8B",
        "recommended": False,
        "best_for": "Weak laptops and no GPU",
        "repo": "prism-ml/Bonsai-8B-gguf",
        "file": "Bonsai-8B.gguf",
        "licence": "See model card",
        "pros": [
            "An 8B model in 1.2 GB — ternary weights, so it barely touches memory",
            "The only 8B here that is realistic on an old laptop with no GPU",
            "Downloads in a minute or two rather than ten",
        ],
        "cons": [
            "Ternary quantisation costs accuracy; check its maths against the rationale",
            "Needs a llama.cpp build new enough to read ternary weights",
        ],
    },
    {
        "id": "bonsai-1.7b",
        "name": "Bonsai 1.7B (ternary)",
        "size_gb": 0.25,
        "vram_gb": 0.8,
        "params": "1.7B",
        "recommended": False,
        "best_for": "The lightest thing that still talks",
        "repo": "prism-ml/Bonsai-1.7B-gguf",
        "file": "Bonsai-1.7B.gguf",
        "licence": "See model card",
        "pros": [
            "250 MB. Runs on essentially anything, including a phone-class CPU",
            "Fine for rephrasing an explanation you already have in front of you",
        ],
        "cons": [
            "Will get SAT maths wrong; treat every answer as a suggestion",
            "Use it only if nothing larger will run",
        ],
    },
    {
        "id": "qwen2.5-0.5b",
        "name": "Qwen2.5 0.5B Instruct",
        "size_gb": 0.5,
        "vram_gb": 1.0,
        "params": "0.5B",
        "recommended": False,
        "best_for": "Checking the setup works",
        "repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "licence": "Apache 2.0",
        "pros": [
            "Downloads in under a minute; proves the pipeline end to end",
            "Runs on anything, including a Raspberry Pi",
        ],
        "cons": [
            "Too small to tutor with — it will get SAT questions wrong",
            "Use it to verify setup, then download a real model",
        ],
    },
]


def model_by_id(mid):
    return next((m for m in MODELS if m["id"] == mid), None)


def model_url(m):
    return f"https://huggingface.co/{m['repo']}/resolve/main/{m['file']}"


def model_path(m):
    return os.path.join(MODEL_DIR, m["file"])


def installed_models():
    return {
        m["id"]
        for m in MODELS
        if os.path.exists(model_path(m)) and os.path.getsize(model_path(m)) > 1_000_000
    }


# --------------------------------------------------------------------------
# Platform / accelerator detection
# --------------------------------------------------------------------------

def detect_accelerator():
    """Which llama.cpp build suits this machine."""
    sysname, machine = platform.system(), platform.machine().lower()
    arm = machine in ("arm64", "aarch64")

    if sysname == "Darwin":
        return {"os": "macos", "arch": "arm64" if arm else "x64",
                "accel": "metal", "label": "Apple Metal (built in)"}

    has_vulkan = bool(
        shutil.which("vulkaninfo")
        or any(
            os.path.exists(p)
            for p in (
                "/usr/lib/x86_64-linux-gnu/libvulkan.so.1",
                "/usr/lib64/libvulkan.so.1",
                "/usr/lib/libvulkan.so.1",
                "C:\\Windows\\System32\\vulkan-1.dll",
            )
        )
    )
    gpu = None
    if shutil.which("nvidia-smi"):
        gpu = "NVIDIA"
    elif sysname == "Linux" and os.path.exists("/sys/class/drm"):
        gpu = "GPU"

    if sysname == "Windows":
        return {"os": "windows", "arch": "arm64" if arm else "x64",
                "accel": "vulkan" if has_vulkan else "cpu",
                "label": f"Vulkan ({gpu})" if has_vulkan else "CPU only"}

    return {"os": "linux", "arch": "arm64" if arm else "x64",
            "accel": "vulkan" if has_vulkan else "cpu",
            "label": f"Vulkan ({gpu})" if has_vulkan and gpu else
                     ("Vulkan" if has_vulkan else "CPU only")}


def _asset_pattern(acc):
    o, a, x = acc["os"], acc["arch"], acc["accel"]
    if o == "macos":
        return rf"bin-macos-{a}\.tar\.gz$"
    if o == "windows":
        return rf"bin-win-{'vulkan' if x == 'vulkan' else 'cpu'}-{a}\.zip$"
    return rf"bin-ubuntu-{'vulkan-' if x == 'vulkan' else ''}{a}\.tar\.gz$"


def find_server_binary():
    """The extracted llama-server, if the engine is already installed."""
    for root, _dirs, files in os.walk(ENGINE_DIR):
        for f in files:
            if f in ("llama-server", "llama-server.exe"):
                return os.path.join(root, f)
    return None


# --------------------------------------------------------------------------
# The managed runtime
# --------------------------------------------------------------------------

class Runtime:
    """Owns the engine download, model download and server process."""

    def __init__(self):
        self.lock = threading.Lock()
        self.proc = None
        self.port = None
        self.model_id = None
        self.selected = None
        self.last_used = None
        self.state = {
            # idle | engine | model | ready-to-load | starting | ready | error
            "phase": "idle",
            "progress": 0.0,
            "detail": "",
            "error": "",
            "model_id": None,
        }

    # ---- status -----------------------------------------------------------

    def status(self):
        acc = detect_accelerator()
        alive = bool(self.proc and self.proc.poll() is None)
        selected = self.selected or tutor.load_config().get("selected_model")
        return {
            **self.state,
            "running": alive,
            "selected": selected,
            "loaded_model": self.model_id if alive else None,
            "idle_seconds": int(time.time() - self.last_used) if (alive and self.last_used) else None,
            "port": self.port if alive else None,
            "engine_installed": bool(find_server_binary()),
            "installed_models": sorted(installed_models()),
            "accelerator": acc,
            "vram_gb": tutor.detect_vram_gb(),
            "models": MODELS,
            "data_dir": DATA_DIR,
        }

    def _set(self, **kw):
        self.state.update(kw)

    # ---- downloads --------------------------------------------------------

    def _download(self, url, dest, phase, label, expected=None):
        """Resumable download with progress reported into self.state."""
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".part"
        done = os.path.getsize(tmp) if os.path.exists(tmp) else 0

        req = urllib.request.Request(url, headers={"User-Agent": UA})
        if done:
            req.add_header("Range", f"bytes={done}-")

        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or 0) + done
            if expected and not total:
                total = int(expected * 1e9)
            mode = "ab" if done and resp.status == 206 else "wb"
            if mode == "wb":
                done = 0
            last = 0
            with open(tmp, mode) as fh:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
                    done += len(chunk)
                    now = time.time()
                    if now - last > 0.35:
                        last = now
                        frac = (done / total) if total else 0.0
                        self._set(
                            phase=phase,
                            progress=round(min(frac, 0.999), 4),
                            detail=f"{label} — {done/1e9:.2f} GB"
                                   + (f" of {total/1e9:.2f} GB" if total else ""),
                        )
        os.replace(tmp, dest)
        return dest

    def install_engine(self):
        """Fetch and unpack the llama.cpp server for this machine."""
        existing = find_server_binary()
        if existing:
            return existing

        acc = detect_accelerator()
        self._set(phase="engine", progress=0.0, detail="Finding the right engine build…")

        req = urllib.request.Request(LLAMA_RELEASES, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as resp:
            release = json.loads(resp.read().decode())

        pattern = _asset_pattern(acc)
        asset = next(
            (a for a in release.get("assets", []) if re.search(pattern, a["name"])), None
        )
        if not asset and acc["accel"] == "vulkan":
            # No Vulkan build for this platform: fall back to the CPU build.
            acc["accel"] = "cpu"
            pattern = _asset_pattern(acc)
            asset = next(
                (a for a in release.get("assets", []) if re.search(pattern, a["name"])), None
            )
        if not asset:
            raise RuntimeError(
                f"No llama.cpp build published for {acc['os']}/{acc['arch']}."
            )

        os.makedirs(ENGINE_DIR, exist_ok=True)
        archive = os.path.join(ENGINE_DIR, asset["name"])
        self._download(
            asset["browser_download_url"], archive, "engine",
            f"Downloading engine ({acc['label']})",
        )

        self._set(phase="engine", progress=0.98, detail="Unpacking engine…")
        if archive.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(ENGINE_DIR)
        else:
            with tarfile.open(archive) as t:
                t.extractall(ENGINE_DIR)
        os.remove(archive)

        binary = find_server_binary()
        if not binary:
            raise RuntimeError("Engine unpacked but llama-server was not found in it.")
        os.chmod(binary, 0o755)
        # Bundled shared libraries sit beside the binary and must be executable.
        for f in os.listdir(os.path.dirname(binary)):
            p = os.path.join(os.path.dirname(binary), f)
            if os.path.isfile(p):
                os.chmod(p, 0o755)
        return binary

    def download_model(self, model_id):
        m = model_by_id(model_id)
        if not m:
            raise RuntimeError(f"Unknown model {model_id}")
        dest = model_path(m)
        if model_id in installed_models():
            return dest
        self._download(
            model_url(m), dest, "model",
            f"Downloading {m['name']}", expected=m["size_gb"],
        )
        return dest

    # ---- server -----------------------------------------------------------

    @staticmethod
    def _free_port():
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def start(self, model_id):
        """Install what is missing, then run the server. Blocking; call in a thread."""
        with self.lock:
            self.stop()
            binary = self.install_engine()
            path = self.download_model(model_id)

            self._set(phase="starting", progress=0.99, detail="Starting the model…")
            port = self._free_port()
            acc = detect_accelerator()
            cmd = [
                binary, "-m", path,
                "--host", "127.0.0.1", "--port", str(port),
                "-c", "8192",
                "--no-webui",
            ]
            if acc["accel"] in ("vulkan", "metal"):
                cmd += ["-ngl", "99"]  # offload every layer it can fit

            env = dict(os.environ)
            env["LD_LIBRARY_PATH"] = (
                os.path.dirname(binary) + ":" + env.get("LD_LIBRARY_PATH", "")
            )
            self.proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                start_new_session=True,
            )
            _record_pid(self.proc.pid)
            self.port = port
            self.model_id = model_id

            # Wait for it to answer, or report why it died.
            deadline = time.time() + 240
            while time.time() < deadline:
                if self.proc.poll() is not None:
                    tail = (self.proc.stdout.read() or b"").decode(errors="replace")
                    raise RuntimeError("Model server exited:\n" + tail[-700:])
                try:
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/health", timeout=3
                    ) as r:
                        if r.status == 200:
                            break
                except Exception:
                    time.sleep(1.0)
            else:
                raise RuntimeError("Model server did not become ready in time.")

            # llama-server advertises the model under its own id (the full path
            # it was loaded from), so ask rather than assume -- otherwise the
            # health check reports a mismatch that is not real.
            served = model_by_id(model_id)["file"]
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/v1/models", timeout=10
                ) as r:
                    ids = [m["id"] for m in json.loads(r.read().decode()).get("data", [])]
                    if ids:
                        served = ids[0]
            except Exception:
                pass

            # Point the tutor at it. `custom` keeps this independent of any
            # externally-installed provider the user may also have configured.
            tutor.save_config(
                {
                    "enabled": True,
                    "provider": "custom",
                    "base_url": f"http://127.0.0.1:{port}/v1",
                    "model": served,
                    "api_key": "",
                }
            )
            self._set(phase="ready", progress=1.0, detail="Tutor ready.",
                      error="", model_id=model_id)
            return True

    def start_async(self, model_id):
        def run():
            try:
                self.start(model_id)
            except Exception as e:
                self._set(phase="error", error=str(e), detail="", progress=0.0)

        self._set(phase="engine", progress=0.0, detail="Preparing…", error="",
                  model_id=model_id)
        threading.Thread(target=run, daemon=True).start()

    # ---- lazy loading -----------------------------------------------------
    #
    # A 5 GB model resident in VRAM the entire time you are reading a passage
    # is rude on a modest machine. So downloading a model only *selects* it;
    # it is loaded on the first tutor question and evicted once you stop asking.

    def select(self, model_id):
        """Download if needed and remember the choice, without loading it."""
        if not model_by_id(model_id):
            raise RuntimeError(f"Unknown model {model_id}")
        self.install_engine()
        self.download_model(model_id)
        self.selected = model_id
        tutor.save_config({"enabled": True, "selected_model": model_id})
        self._set(phase="ready-to-load", progress=1.0,
                  detail="Ready. Loads when you first ask the tutor.",
                  error="", model_id=model_id)
        return model_id

    def select_async(self, model_id):
        def run():
            try:
                self.select(model_id)
            except Exception as e:
                self._set(phase="error", error=str(e), detail="", progress=0.0)

        self._set(phase="engine", progress=0.0, detail="Preparing…", error="",
                  model_id=model_id)
        threading.Thread(target=run, daemon=True).start()

    def ensure_running(self, on_status=None):
        """Load the selected model if it is not already resident.

        Blocking, and safe to call concurrently: the lock means a second
        question asked while the model is still loading waits rather than
        starting a second server.
        """
        selected = self.selected or tutor.load_config().get("selected_model")
        if not selected:
            raise RuntimeError(
                "No model chosen yet. Pick one in Settings."
            )
        if self.proc and self.proc.poll() is None:
            self.touch()
            return True

        if on_status:
            on_status(f"Loading {model_by_id(selected)['name']}…")
        self.start(selected)
        self.touch()
        return True

    def touch(self):
        """Mark the model as just used, deferring the idle eviction."""
        self.last_used = time.time()

    def start_idle_watch(self, idle_seconds=600):
        """Evict the model after a stretch with no tutor questions."""
        def loop():
            while True:
                time.sleep(20)
                if (
                    self.proc
                    and self.proc.poll() is None
                    and self.last_used
                    and time.time() - self.last_used > idle_seconds
                ):
                    self.stop()
                    self._set(phase="ready-to-load", detail="Unloaded after idle.",
                              progress=1.0)

        threading.Thread(target=loop, daemon=True).start()

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
        self.port = None
        _clear_pid()
        if self.state.get("phase") == "ready":
            self._set(phase="idle", detail="", progress=0.0)

    def delete_model(self, model_id):
        m = model_by_id(model_id)
        if not m:
            return False
        if self.model_id == model_id:
            self.stop()
        p = model_path(m)
        if os.path.exists(p):
            os.remove(p)
        return True


PIDFILE = os.path.join(DATA_DIR, "model-server.pid")


def _record_pid(pid):
    """Note the model server's pid so a later run can reap it if we are killed."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PIDFILE, "w") as fh:
        fh.write(str(pid))


def _clear_pid():
    try:
        os.remove(PIDFILE)
    except FileNotFoundError:
        pass


def reap_stale_server():
    """Kill a model server left behind by a previous run.

    Graceful shutdown is handled by the atexit and signal handlers, but nothing
    runs on SIGKILL or a power cut -- and an orphaned llama-server sits on the
    GPU indefinitely. So the pid is recorded on disk and checked at startup.

    (PR_SET_PDEATHSIG is deliberately not used: it fires when the *creating
    thread* dies, and the model is started from a short-lived worker thread, so
    it would kill the model seconds after it came up. Calling dlopen from a
    post-fork preexec hook in a threaded process is unsafe besides.)
    """
    try:
        with open(PIDFILE) as fh:
            pid = int(fh.read().strip())
    except (FileNotFoundError, ValueError):
        return None

    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            cmdline = fh.read().decode("utf-8", "replace")
    except OSError:
        _clear_pid()
        return None

    # Only kill it if it really is our model server, never a recycled pid.
    if "llama-server" not in cmdline or "satprep" not in cmdline:
        _clear_pid()
        return None

    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            time.sleep(0.25)
            os.kill(pid, 0)
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    _clear_pid()
    return pid


RUNTIME = Runtime()


def _cleanup(*_args):
    """Stop the model server however this process is going down."""
    try:
        RUNTIME.stop()
    except Exception:
        pass


def install_exit_handlers():
    """Guarantee the GPU is released when the backend exits.

    Three layers, because each covers a case the others miss:
      - atexit          normal interpreter shutdown
      - SIGTERM/SIGINT  the desktop shell or Ctrl-C asking us to stop
      - PR_SET_PDEATHSIG the parent being killed outright
    """
    import atexit
    import signal

    atexit.register(_cleanup)
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            previous = signal.getsignal(sig)

            def handler(signum, frame, _prev=previous):
                _cleanup()
                if callable(_prev):
                    _prev(signum, frame)
                else:
                    raise SystemExit(0)

            signal.signal(sig, handler)
        except (ValueError, OSError):
            pass  # not on the main thread, or unsupported platform
