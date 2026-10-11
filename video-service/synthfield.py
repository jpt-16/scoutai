"""A drawn football field seen through a camera, for tests: the real paint (yard lines every 5,
sidelines, a hash tick every yard) with grass texture, warped onto a 1920x1080 frame by a
known matrix, so what `eval.field` finds can be checked against the truth."""

import cv2
import numpy as np

FIELD_W = 160 / 3
HASH_IN = 17.78
PPY = 14  # canvas pixels per yard
MARGIN = 6  # yards of grass around the field
Y0, Y1 = 0, 100

# Camera A: down the field, yard lines horizontal across the picture, sidelines converging.
QUAD_A = {(0, 30): (100, 980), (FIELD_W, 30): (1820, 980), (0, 70): (480, 260), (FIELD_W, 70): (1440, 260)}
# Camera B: from the stands, the field runs left to right, near sideline at the bottom.
# World x grows toward the camera (the viewer's right when facing +y), so it is a valid view.
QUAD_B = {(0, 20): (500, 380), (0, 80): (1420, 380), (FIELD_W, 20): (50, 1000), (FIELD_W, 80): (1870, 1000)}


def world_to_pixel(quad: dict) -> np.ndarray:
    return cv2.getPerspectiveTransform(np.float32(list(quad.keys())), np.float32(list(quad.values())))


def top_down(ticks: bool = True, sidelines: bool = True, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h, w = int((Y1 - Y0) * PPY), int((FIELD_W + 2 * MARGIN) * PPY)
    canvas = np.zeros((h, w, 3), np.uint8)
    canvas[:] = (60, 130, 55)
    canvas = np.clip(canvas.astype(np.int16) + rng.integers(-14, 14, canvas.shape), 0, 255).astype(np.uint8)
    canvas = cv2.GaussianBlur(canvas, (0, 0), 1.2)

    def pt(x, y):
        return int(round((x + MARGIN) * PPY)), int(round((y - Y0) * PPY))

    white = (235, 235, 235)
    for y in range(Y0, Y1 + 1, 5):
        cv2.line(canvas, pt(0, y), pt(FIELD_W, y), white, max(1, int(0.35 * PPY)))
    if sidelines:
        for x in (0, FIELD_W):
            cv2.line(canvas, pt(x, Y0), pt(x, Y1), white, max(1, int(0.35 * PPY)))
    if ticks:
        for y in range(Y0, Y1 + 1):
            for x in (HASH_IN, FIELD_W - HASH_IN):
                cv2.line(canvas, pt(x - 0.4, y), pt(x + 0.4, y), white, max(1, int(0.14 * PPY)))
    return canvas


def render(quad: dict, canvas: np.ndarray | None = None, size=(1920, 1080)) -> tuple[np.ndarray, np.ndarray]:
    """The frame and the true world -> pixel matrix."""
    canvas = top_down() if canvas is None else canvas
    to_canvas = np.array([[PPY, 0, MARGIN * PPY], [0, PPY, -Y0 * PPY], [0, 0, 1]], float)
    h = world_to_pixel(quad)
    frame = np.full((size[1], size[0], 3), (40, 90, 40), np.uint8)
    warped = cv2.warpPerspective(canvas, h @ np.linalg.inv(to_canvas), size, flags=cv2.INTER_AREA)
    inside = cv2.warpPerspective(np.full(canvas.shape[:2], 255, np.uint8), h @ np.linalg.inv(to_canvas), size)
    frame[inside > 0] = warped[inside > 0]
    return frame, h
