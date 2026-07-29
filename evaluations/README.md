# Evaluations

This folder has everything I used to produce the numbers in the paper. Nothing
here is imported by the running application. It is the other way around: these
scripts import the application's own modules from `apps/api`, so whatever is
measured here is the same code that ships.

Run all the commands from the repository root. Each script adds `apps/api` to
the import path and switches the working directory there, because that is where
the settings loader looks for `.env` and where the bundled citation styles are
resolved from.

## Setup

First find the user id whose data you want to measure. This is the Better Auth
user id, which is the `sub` claim inside the token and the `user_id` column on
every row.

```sql
SELECT id, email FROM "user";
```

After that you can either pass it every time with `--user`, or set it once:

```
set EVAL_USER_ID=<the id>
```

## 1. Screening against human decisions (RQ1, Table 2)

The dataset has to be built first. This downloads the SYNERGY collection, which
is public domain, and then fetches the titles and abstracts from OpenAlex.

```
apps\api\venv\Scripts\python.exe evaluations\prepare_synergy.py
```

It writes one CSV per review into `evaluations/data/screening/` with the columns
`id,title,abstract,label`, and a `.topic.txt` file beside each one. Then run the
screening stage:

```
apps\api\venv\Scripts\python.exe evaluations\run_eval.py --stage screening --chunk 40
```

This reports recall, precision, F1, WSS@95% and MAP for each review and pooled
together, with a bootstrap interval on recall.

One thing to keep in mind while reading these numbers. SYNERGY does not
redistribute the original inclusion and exclusion criteria, so this measures the
topic only path. It is a lower bound on what the criteria based stage can do.

## 2. Citation grounding (RQ2, Table 3)

Generate a few documents in the application before running this. The script
reads every document that is `ready` and linked to a run, pulls the citation
markers out of each section, checks whether each marker resolves to a real
reference, and then asks a judge model whether the cited passage actually
supports the sentence.

```
apps\api\venv\Scripts\python.exe evaluations\run_eval.py --stage citations --sample 2
```

For the control, which is the same model writing the same sections with the
evidence block withheld:

```
apps\api\venv\Scripts\python.exe evaluations\ungrounded_control.py --user <id>
```

The support numbers in the paper come from a model judge. A judge model grading
output from its own family is weak evidence on its own, so the honest next step
is to take a random subsample of the judged sentences, label them by hand
without looking at the verdict, and report the agreement. I have not done this
yet and the paper says so plainly.

## 3. Index ablation (RQ3, Table 4)

This replays search queries that real runs actually issued, first against one
index at a time and then against all four together.

```
apps\api\venv\Scripts\python.exe evaluations\index_ablation.py --user <id> --queries 12
```

The pacing between queries matters more than it looks. Firing a dozen queries at
arXiv one after another trips its rate limiter and returns nothing, which then
shows up as that index contributing zero papers. That is an artefact and not a
finding, and I nearly published it as one.

## 4. Staged graph against bounded tool loop (RQ4, Table 5)

This puts the same four research questions through both architectures.

- The loop arm is `agent/assistant.py`, exactly as the chat surface uses it.
- The graph arm inserts a real run row and drives `agent/runner._execute`, which
  is what the API route does, so running this creates four runs in whichever
  account you pass.

```
apps\api\venv\Scripts\python.exe evaluations\architecture_compare.py --user <id>
```

Model calls are counted by wrapping `ResolvedLlm._call`, so retries are counted
as well. A retry is a call the provider served and a cost the user pays, and
hiding it would flatter whichever arm retries more. Each question is saved as
soon as it finishes, so a rerun skips whatever is already stored.

## 5. Reproducibility (Section 7.6)

This runs one topic five times with every setting held constant and reports the
mean pairwise Jaccard overlap of the selected paper sets.

```
apps\api\venv\Scripts\python.exe evaluations\reproducibility.py --user <id> --repeats 5
```

Papers are keyed on DOI wherever one exists, so the same paper reached through
two different indexes is counted once. This also creates five runs in the
account.

## 6. Cost and latency (RQ5, Table 6)

This one needs no new runs. It reads the run event log, which already has a
timestamp on every stage.

```
apps\api\venv\Scripts\python.exe evaluations\run_eval.py --stage cost
```

Stage duration is worked out by stage transition and not by taking the minimum
and maximum timestamp inside each stage. The reason is that a resumed run visits
the same stage twice, and grouping by min and max quietly puts all the idle time
between the two visits inside that stage. Blocks with a gap of more than fifteen
minutes are dropped as interrupted.

## Output

Every stage appends to `evaluations/results.json`, and the keys in that file map
onto the numbers quoted in the paper.

## Still to be done

Human labelling of citation support. The harness already writes every judged
sentence, along with its retrieved passage and the judge verdict, into
`results.json`. Take a random subsample, label it without looking at the
verdict, and report the agreement. This is the one number in the paper that a
model cannot supply.

## Why the data and results are committed

Everything in this folder is committed, including `data/` and `results.json`,
and that is a deliberate choice.

The scripts on their own would let somebody rerun the evaluation, but they would
get their own numbers from their own model calls and would have no way to check
mine. With the datasets and the raw output sitting in the repository, a reviewer
can recompute every figure in the paper from the recorded verdicts and timings
without spending a single model call, and can see exactly which papers each run
selected. Reproducibility is one of the gaps the paper claims to address, so it
seemed only fair to ship the evidence and not just the recipe.

The sizes are small enough that this costs nothing:

- `data/` is about 3 MB, which is the SYNERGY records together with the titles
  and abstracts fetched from OpenAlex.
- `results.json` is about 128 KB. It holds the per review screening counts,
  every citation verdict, the index ablation, the architecture comparison
  including the full answers from both arms, and the five reproducibility runs
  with their selected paper sets.

There are no secrets in any of it. No API key, no token and no email address
appears in the output, and the only identifiers are internal run and document
UUIDs. If you add a new stage later, please check that this is still true before
committing.
