"""Which chip to run the detector on: an Nvidia GPU, an Apple one (Mac M-series), or the CPU."""

from __future__ import annotations


def pick_device():
    import torch

    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
