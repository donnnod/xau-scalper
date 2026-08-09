"""
The Python/TypeScript boundary, enforced rather than merely documented.

Teo once carried its own backtest engine, parameter sweep, regime detector and
self-heal loop. TypeScript grew its own, and for a while both existed — which is
not a redundancy, it is a disagreement waiting to be discovered. They did in fact
disagree: the Python backtest ran an EMA-crossover proxy that was never the
dashboard's strategy (34 trades on a window where the real one fires none), and
its hedge mode was a measurable no-op producing identical Calmar, profit factor
and win rate to the unhedged run.

The Python copies were deleted. This test exists so they cannot quietly return.
A comment in a README does not survive contact with a future change; a failing
test does.

**The boundary.** Python owns forecasting — Kronos has no TypeScript equivalent
and that is the whole reason this process still exists. TypeScript owns anything
that decides a trade: strategy, indicators, backtest, costs, sweep, regime,
self-heal, portfolio risk, significance.

If you are here because this test failed, the question to ask is not "how do I
make it pass" but "does this belong in core/ instead". It almost certainly does.
"""

from __future__ import annotations

from pathlib import Path

TEO = Path(__file__).resolve().parent.parent / "teo"

# Vendored third-party code is exempt: it is not ours to restructure, and Kronos
# is the capability this whole package exists to serve.
EXEMPT = {"vendor"}

# Substrings that indicate trade-deciding logic rather than forecasting.
FORBIDDEN = [
    "def run_backtest",
    "def run_sweep",
    "def detect_regime",
    "def score_metrics",
    "def assess",
    "class HealthThresholds",
    "class OutcomeMemory",
    "def portfolio_risk",
    "def breakeven_win_rate",
]


def _python_files() -> list[Path]:
    return [
        p
        for p in TEO.rglob("*.py")
        if not any(part in EXEMPT for part in p.relative_to(TEO).parts)
        and "__pycache__" not in p.parts
    ]


def test_python_does_not_reimplement_trade_logic() -> None:
    offenders: list[str] = []
    for path in _python_files():
        source = path.read_text(encoding="utf-8")
        for marker in FORBIDDEN:
            if marker in source:
                offenders.append(f"{path.relative_to(TEO.parent)}: {marker}")

    assert not offenders, (
        "Trade-deciding logic reappeared in Python:\n  "
        + "\n  ".join(offenders)
        + "\n\nThis belongs in core/ (TypeScript), which is what the engine "
        "actually runs. Two implementations of one decision can disagree, and "
        "the last pair did."
    )


def test_the_modules_that_were_removed_stay_removed() -> None:
    removed = [
        "loop.py",
        "selfheal.py",
        "memory.py",
        "strategies.py",
        "assets.py",
        "dashboard.py",
        "backtest/engine.py",
        "backtest/sweep.py",
        "backtest/regime.py",
    ]
    present = [name for name in removed if (TEO / name).exists()]
    assert not present, (
        f"Superseded Python modules are back: {present}. "
        "Their TypeScript equivalents live in core/ and server/."
    )


def test_forecasting_still_exists() -> None:
    """The boundary cuts both ways — Python must keep the capability it owns."""
    assert (TEO / "forecasting" / "kronos.py").exists()
    assert (TEO / "vendor" / "kronos").is_dir()


def test_the_service_serves_only_forecasting() -> None:
    from teo.main import app

    paths = {
        r.path
        for r in app.routes
        if hasattr(r, "path") and not r.path.startswith(("/openapi", "/docs", "/redoc"))
    }
    assert paths == {"/health", "/forecast"}, (
        f"Unexpected routes: {sorted(paths)}. Anything that decides a trade is "
        "served by the TypeScript app on /api/*, not from here."
    )
