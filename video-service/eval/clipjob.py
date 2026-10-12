"""One clip, start to finish: calibrate it, read its formation, follow everyone through the play.

This is the unit both runners share. `eval.game` loops over a folder of clips with it, and the
hosted worker (`eval.worker`) runs it on a thread per clip. It never raises for a clip it
can't do: a clip the field can't be found in is `needs_hand`, a clip that blows up is `failed`
with the reason, and either way the rest of the game carries on.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from .autocalib import SceneFailure, auto_calibrate
from .field import FieldFailure
from .presnap import play_number, read_clip
from .tracks import track_clip

DONE = "done"
NEEDS_HAND = "needs_hand"
FAILED = "failed"


@dataclass
class ClipResult:
    name: str
    status: str
    reason: str = ""
    formation: str = ""
    strength: str = ""
    seconds: float = 0.0
    tracks: Path | None = None
    timing: dict = field(default_factory=dict)

    def row(self, index: int) -> dict:
        """This clip's line of `ours.csv` (what `scripts/tracks-to-cards.ts --formations` reads)."""
        return {"PLAY #": play_number(Path(self.name), index), "OFF FORM": self.formation, "OFF STR": self.strength}


def process_clip(
    clip: Path,
    detector,
    tracks_dir: Path,
    debug_dir: Path | None,
    *,
    seconds: float = 8.0,
    tiles: int = 3,
    region: bool = True,
    detections_dir: Path | None = None,
) -> ClipResult:
    """Calibrate (unless a `.json` is already beside the clip: a hand calibration always wins), read the
    formation, and write `tracks_dir/<stem>.json` (unless it is already there)."""
    started = time.monotonic()
    try:
        calib = clip.with_suffix(".json")
        if not calib.exists():
            result = auto_calibrate(clip, detector, tiles, debug_dir)
            if isinstance(result, (FieldFailure, SceneFailure)):
                return ClipResult(clip.name, NEEDS_HAND, reason=result.reason, seconds=time.monotonic() - started)
            calib.write_text(json.dumps(result, indent=2))
        formation = read_clip(clip, detector, tiles, debug_dir)["formation"]
        out = tracks_dir / f"{clip.stem}.json"
        timing: dict = {}
        if not out.exists():
            debug: dict | None = {} if detections_dir is not None else None
            tracked = track_clip(clip, detector, seconds, tiles, debug, region)
            out.write_text(json.dumps(tracked))
            timing = tracked.get("timing", {})
            if debug is not None:
                from .trackdebug import write_detections

                write_detections(debug, detections_dir, clip.stem)
        return ClipResult(
            clip.name,
            DONE,
            formation=formation.key,
            strength=formation.strength or "",
            seconds=time.monotonic() - started,
            tracks=out,
            timing=timing,
        )
    except Exception as error:  # one bad clip must not take the game down with it
        return ClipResult(clip.name, FAILED, reason=f"{type(error).__name__}: {error}", seconds=time.monotonic() - started)
