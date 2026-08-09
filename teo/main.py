"""
Teo FastAPI service — forecasting only.

This process exists for ONE reason: Kronos, a pretrained time-series model that
has no TypeScript equivalent. Everything else Teo used to serve — backtesting,
parameter sweeps, regime detection, self-heal — now lives in TypeScript and runs
in-process in the main app. See "Who owns what" in the README.

The duplicated versions were removed rather than left in place because two
implementations of the same decision can disagree, and these two did: the Python
backtest ran an EMA-crossover proxy that was never the dashboard's strategy, and
its hedge mode was a measurable no-op. Reviving any of it here would reintroduce
that split. tests/test_no_strategy_logic.py fails if anyone tries.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from teo import __version__
from teo.config import settings
from teo.data.binance import fetch_klines
from teo.forecasting.base import BaselineForecaster
from teo.forecasting.kronos import KronosUnavailable, get_kronos
from teo.models import ForecastRequest, ForecastResponse

app = FastAPI(title="Teo", version=__version__)

_baseline = BaselineForecaster()


def _active_forecaster_name() -> str:
    k = get_kronos()
    return k.name if k is not None else _baseline.name


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "forecaster": _active_forecaster_name(),
        "data_source": settings.binance_base_url,
    }


@app.post("/forecast", response_model=ForecastResponse)
async def forecast(req: ForecastRequest) -> ForecastResponse:
    if req.horizon > settings.max_horizon:
        raise HTTPException(400, f"horizon exceeds max {settings.max_horizon}")

    candles = req.candles
    if not candles:
        try:
            candles = await fetch_klines(req.symbol, req.interval, limit=req.lookback)
        except Exception as e:  # upstream data error
            raise HTTPException(502, f"failed to fetch candles: {e}") from e
    if len(candles) < 20:
        raise HTTPException(422, "need at least 20 candles to forecast")

    # Prefer Kronos when available; fall back to baseline transparently.
    kronos = get_kronos()
    if kronos is not None:
        try:
            return kronos.forecast(
                candles, req.horizon, symbol=req.symbol, interval=req.interval
            )
        except KronosUnavailable:
            pass  # fall through to baseline

    return _baseline.forecast(candles, req.horizon, symbol=req.symbol, interval=req.interval)
