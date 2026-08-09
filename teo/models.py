"""Pydantic schemas for the forecasting service.

Trimmed to what /forecast needs. The strategy, backtest, sweep and self-heal
schemas that used to live here were removed alongside the Python
implementations of those things -- they are TypeScript now. See "Who owns what"
in the README.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Candle(BaseModel):
    """A single OHLCV bar. `time` is epoch milliseconds (Binance kline open time)."""

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class ForecastRequest(BaseModel):
    symbol: str = Field(
        "BTCUSDT", description="Binance data-source symbol, e.g. BTCUSDT or PAXGUSDT"
    )
    interval: str = Field("5m", description="Kline interval, e.g. 1m/5m/15m/1h")
    horizon: int = Field(12, ge=1, le=120, description="How many future bars to forecast")
    # If candles are supplied, Teo uses them directly; otherwise it fetches recent history.
    candles: list[Candle] | None = None
    lookback: int = Field(200, ge=20, le=2000, description="Bars to fetch when candles omitted")


class ForecastPoint(BaseModel):
    step: int
    close: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    symbol: str
    interval: str
    model: str  # "kronos:<id>" or "baseline"
    horizon: int
    last_close: float
    points: list[ForecastPoint]
    # Compact directional read the dashboard can fold into its TA grade.
    direction: str  # "up" | "down" | "flat"
    expected_return: float  # fractional return over the horizon
    confidence: float  # 0..1
    note: str | None = None
