"""
Single source of truth for the basketball Gravity Score.

Kept dependency-free so the root prototype app and the Stat Miner backend can
both import it.
"""

from __future__ import annotations

THREE_PA_WEIGHT = 1.5
DRIVES_WEIGHT = 1.2
ASSISTS_WEIGHT = 2.0

FORMULA = (
    f"3PA×{THREE_PA_WEIGHT:g} + Drives×{DRIVES_WEIGHT:g} + "
    f"Ast×{ASSISTS_WEIGHT:g}/(TOV+1)"
)

# Raw per-game scores mapped linearly onto 0–100 UVS. Bench players sit near
# the floor; the league's heaviest drive/3PA creators land around 40–45, so the
# ceiling leaves headroom instead of pinning every star at 100.
UVS_RAW_FLOOR = 5.0
UVS_RAW_CEILING = 50.0


def gravity_components(
    three_point_attempts: float,
    drives: float,
    assists: float,
    turnovers: float,
) -> dict[str, float]:
    """Each term of the formula: spacing (3PA), rim pressure (drives), playmaking."""
    return {
        "spacing": three_point_attempts * THREE_PA_WEIGHT,
        "rim_pressure": drives * DRIVES_WEIGHT,
        "playmaking": (assists * ASSISTS_WEIGHT) / (max(turnovers, 0.0) + 1.0),
    }


def gravity_score(
    three_point_attempts: float,
    drives: float,
    assists: float,
    turnovers: float,
) -> float:
    """Raw Gravity Score from per-game stats. Higher is better."""
    return sum(gravity_components(three_point_attempts, drives, assists, turnovers).values())


def gravity_to_uvs(raw: float) -> float:
    """Scale a raw Gravity Score onto the 0–100 Unified Value Score."""
    clipped = max(UVS_RAW_FLOOR, min(UVS_RAW_CEILING, raw))
    return 100.0 * (clipped - UVS_RAW_FLOOR) / (UVS_RAW_CEILING - UVS_RAW_FLOOR)
