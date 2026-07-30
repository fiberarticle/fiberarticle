"""Metric functions for the Fiberarticle evaluation.

Kept free of any I/O so each one can be unit checked on hand made inputs.
Every metric here is reported in the paper, so the definition used in the
paper is exactly the definition implemented here.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable, Sequence


# --------------------------------------------------------------- screening
@dataclass
class ScreeningCounts:
    tp: int = 0
    fp: int = 0
    tn: int = 0
    fn: int = 0

    @property
    def total(self) -> int:
        return self.tp + self.fp + self.tn + self.fn

    @property
    def recall(self) -> float:
        d = self.tp + self.fn
        return self.tp / d if d else 0.0

    @property
    def precision(self) -> float:
        d = self.tp + self.fp
        return self.tp / d if d else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0

    @property
    def specificity(self) -> float:
        d = self.tn + self.fp
        return self.tn / d if d else 0.0


def screening_counts(predicted: Sequence[bool],
                     gold: Sequence[bool]) -> ScreeningCounts:
    """Confusion counts for a single review. True means include."""
    if len(predicted) != len(gold):
        raise ValueError("predicted and gold must be the same length")
    c = ScreeningCounts()
    for p, g in zip(predicted, gold):
        if p and g:
            c.tp += 1
        elif p and not g:
            c.fp += 1
        elif (not p) and g:
            c.fn += 1
        else:
            c.tn += 1
    return c


def work_saved_over_sampling(ranking: Sequence[bool], recall_target: float = 0.95) -> float:
    """WSS at a recall target, the standard measure in screening studies.

    `ranking` is the gold relevance of the candidates in the order the system
    ranked them. The screener is assumed to read down the ranking until the
    recall target is reached. WSS is then the share of the corpus that did not
    have to be read, minus the share that random ordering would already save.
    """
    n = len(ranking)
    total_rel = sum(1 for r in ranking if r)
    if n == 0 or total_rel == 0:
        return 0.0
    need = math.ceil(recall_target * total_rel)
    seen_rel = 0
    read = n
    for i, rel in enumerate(ranking, start=1):
        if rel:
            seen_rel += 1
            if seen_rel >= need:
                read = i
                break
    return ((n - read) / n) - (1.0 - recall_target)


def average_precision(ranking: Sequence[bool]) -> float:
    """Average precision of one ranked candidate list."""
    hits = 0
    acc = 0.0
    for i, rel in enumerate(ranking, start=1):
        if rel:
            hits += 1
            acc += hits / i
    total_rel = sum(1 for r in ranking if r)
    return acc / total_rel if total_rel else 0.0


def mean_average_precision(rankings: Iterable[Sequence[bool]]) -> float:
    vals = [average_precision(r) for r in rankings]
    return sum(vals) / len(vals) if vals else 0.0


def recall_at_k(ranking: Sequence[bool], k: int) -> float:
    total_rel = sum(1 for r in ranking if r)
    if not total_rel:
        return 0.0
    return sum(1 for r in ranking[:k] if r) / total_rel


# ------------------------------------------------------- citation checking
_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
# A sentence splitter that does not break on the common academic
# abbreviations or on a citation marker.
_SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def citation_markers(text: str) -> list[int]:
    """Every citation index appearing in the text, in order, with repeats."""
    out: list[int] = []
    for m in _CITE_RE.finditer(text):
        for part in m.group(1).split(","):
            part = part.strip()
            if part.isdigit():
                out.append(int(part))
    return out


def split_sentences(text: str) -> list[str]:
    clean = " ".join(text.split())
    if not clean:
        return []
    return [s.strip() for s in _SENT_RE.split(clean) if s.strip()]


def cited_sentences(text: str) -> list[tuple[str, list[int]]]:
    """(sentence, markers) for every sentence that carries at least one marker."""
    out = []
    for s in split_sentences(text):
        marks = citation_markers(s)
        if marks:
            out.append((s, marks))
    return out


@dataclass
class CitationReport:
    markers_total: int = 0
    markers_valid: int = 0
    sentences_total: int = 0
    sentences_cited: int = 0
    supported: int = 0
    judged: int = 0
    unresolved: list[int] = field(default_factory=list)

    @property
    def marker_validity(self) -> float:
        return self.markers_valid / self.markers_total if self.markers_total else 0.0

    @property
    def citation_density(self) -> float:
        return self.sentences_cited / self.sentences_total if self.sentences_total else 0.0

    @property
    def support_rate(self) -> float:
        return self.supported / self.judged if self.judged else 0.0


def marker_validity(text: str, reference_count: int) -> tuple[int, int, list[int]]:
    """(total markers, valid markers, list of out of range markers).

    A marker is valid when it points at an entry that actually exists in the
    rendered reference list. This catches the failure mode where the model
    invents a citation number that has no source behind it.
    """
    marks = citation_markers(text)
    bad = [m for m in marks if m < 1 or m > reference_count]
    return len(marks), len(marks) - len(bad), bad


# -------------------------------------------------------------- statistics
def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def stdev(xs: Sequence[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def wilson_interval(successes: int, trials: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval, used for the reported proportions.

    The normal approximation is unreliable for proportions close to one,
    which is exactly where the citation validity numbers sit.
    """
    if trials == 0:
        return (0.0, 0.0)
    p = successes / trials
    d = 1 + z * z / trials
    centre = (p + z * z / (2 * trials)) / d
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def bootstrap_ci(values: Sequence[float], rounds: int = 2000,
                 seed: int = 12345, alpha: float = 0.05) -> tuple[float, float]:
    """Percentile bootstrap interval for a mean. Seeded so runs reproduce."""
    import random

    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(values)
    means = []
    for _ in range(rounds):
        sample = [values[rng.randrange(n)] for _ in range(n)]
        means.append(mean(sample))
    means.sort()
    lo = means[int(alpha / 2 * rounds)]
    hi = means[int((1 - alpha / 2) * rounds) - 1]
    return (lo, hi)


def permutation_p(a: Sequence[float], b: Sequence[float],
                  rounds: int = 20000, seed: int = 12345) -> float:
    """Two sided permutation p value for mean(a) - mean(b), unpaired.

    The two arms of the grounding comparison have different numbers of judged
    sentences and no pairing between them, so a paired test does not apply.
    Under the null the label carries no information, which is what shuffling
    the pooled values simulates. Seeded, so the same inputs give the same p.
    """
    import random

    if not a or not b:
        return 1.0
    rng = random.Random(seed)
    observed = abs(mean(a) - mean(b))
    pooled = list(a) + list(b)
    n = len(a)
    extreme = 0
    for _ in range(rounds):
        rng.shuffle(pooled)
        if abs(mean(pooled[:n]) - mean(pooled[n:])) >= observed:
            extreme += 1
    # Add one to both parts so a p value of exactly zero is never reported;
    # 20000 relabellings cannot distinguish "very small" from "impossible".
    return (extreme + 1) / (rounds + 1)


def paired_bootstrap_p(a: Sequence[float], b: Sequence[float],
                       rounds: int = 2000, seed: int = 12345) -> float:
    """Two sided paired bootstrap p value for mean(a) - mean(b)."""
    import random

    if len(a) != len(b) or not a:
        return 1.0
    rng = random.Random(seed)
    observed = mean(a) - mean(b)
    diffs = [x - y for x, y in zip(a, b)]
    centred = [d - mean(diffs) for d in diffs]
    n = len(centred)
    extreme = 0
    for _ in range(rounds):
        sample = [centred[rng.randrange(n)] for _ in range(n)]
        if abs(mean(sample)) >= abs(observed):
            extreme += 1
    return extreme / rounds
