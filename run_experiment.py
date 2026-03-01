"""
LLM Model Optimization Experiment via /admin/llm-benchmark/run endpoint.

Strategy: Call /run with 1 model x 1 question at a time (6 stages per call).
Each HTTP request completes in ~30-90s, well within ngrok's free tier limits.
Total: 4 models x 9 questions = 36 HTTP requests = 216 LLM calls.
"""
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import json
import sys
import time
import os

NGROK_URL = "https://maniacally-unaggravating-delisa.ngrok-free.dev"
RUN_ENDPOINT = f"{NGROK_URL}/admin/llm-benchmark/run"

QUESTIONS = [
    "kyc1_layered_bo",
    "kyc2_vcip_design",
    "kyc3_aadhaar_limits",
    "alm1_sls_mismatch",
    "alm2_ibl_limits",
    "alm3_intraday_liquidity",
    "combined1_board_governance",
    "combined2_correspondent_banking",
    "combined3_overseas_branch",
]

MODELS = ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano"]
STAGES = ["classification", "expansion", "location", "reflection", "synthesis", "verification"]

# Session with retry
session = requests.Session()
retry_strategy = Retry(total=5, backoff_factor=3, status_forcelist=[502, 503, 504])
session.mount("https://", HTTPAdapter(max_retries=retry_strategy))
session.headers.update({
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "1",
})

PROGRESS_FILE = "experiment_progress.json"
RESULTS_FILE = "experiment_results.json"

# Resume support: load previous progress if it exists
all_individual_results = []
completed_keys = set()
if os.path.exists(PROGRESS_FILE):
    with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
        saved = json.load(f)
    all_individual_results = saved.get("results", [])
    for r in all_individual_results:
        completed_keys.add(f"{r['model']}|{r['question_id']}")
    print(f"Resuming: {len(completed_keys)} model x question combos already done")

total_combos = len(MODELS) * len(QUESTIONS)
print("=" * 70)
print("LLM Model Optimization Experiment")
print(f"{len(MODELS)} models x {len(STAGES)} stages x {len(QUESTIONS)} questions = {len(MODELS)*len(STAGES)*len(QUESTIONS)} LLM calls")
print(f"Running as {total_combos} HTTP requests (1 model x 1 question x 6 stages each)")
print("=" * 70)
print(f"Started at: {time.strftime('%H:%M:%S')}", flush=True)

overall_start = time.time()
done = len(completed_keys)

for model in MODELS:
    for qid in QUESTIONS:
        key = f"{model}|{qid}"
        if key in completed_keys:
            continue

        done += 1
        print(f"\n[{done}/{total_combos}] {model} x {qid} (6 stages)...", end="", flush=True)

        payload = {
            "stages": STAGES,
            "models": [model],
            "question_ids": [qid],
        }

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.time()
                resp = session.post(RUN_ENDPOINT, json=payload, timeout=300)
                resp.raise_for_status()
                data = resp.json()
                elapsed = time.time() - t0

                # Extract individual results
                run_results = data.get("results", [])
                all_individual_results.extend(run_results)
                completed_keys.add(key)

                success_count = sum(1 for r in run_results if r.get("success"))
                print(f" {elapsed:.0f}s ({success_count}/6 ok)", flush=True)
                break

            except Exception as e:
                print(f"\n    Attempt {attempt}/{max_retries} FAILED: {e}", flush=True)
                if attempt < max_retries:
                    wait = 10 * attempt
                    print(f"    Retrying in {wait}s...", flush=True)
                    time.sleep(wait)
                else:
                    print(f"    SKIPPING {key}", flush=True)

        # Save progress after each combo
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump({"results": all_individual_results}, f, default=str)

total_elapsed = time.time() - overall_start
print(f"\n\nAll done in {total_elapsed:.0f}s ({total_elapsed/60:.1f} min)")
print(f"Total individual results: {len(all_individual_results)}")

merged_phase1_results = all_individual_results

print(f"\nCompleted at: {time.strftime('%H:%M:%S')}")
print(f"Total elapsed: {total_elapsed:.0f}s ({total_elapsed/60:.1f} min)")
print(f"Total individual LLM calls: {len(merged_phase1_results)}")

# =====================================================================
# Re-aggregate from merged individual results
# =====================================================================
from collections import defaultdict
import itertools

results = merged_phase1_results
groups = defaultdict(list)
for r in results:
    groups[(r["stage"], r["model"])].append(r)

STAGES = ["classification", "expansion", "location", "reflection", "synthesis", "verification"]
MODELS = ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano"]
BASELINE_MAP = {
    "classification": "gpt-5.2",
    "expansion": "gpt-5.2",
    "location": "gpt-5.2",
    "reflection": "gpt-5.2",
    "synthesis": "gpt-5.2-pro",
    "verification": "gpt-5.2-pro",
}

# Build aggregated stats per (stage, model)
agg_table = {}
for (stage, model), items in groups.items():
    success = [i for i in items if i.get("success")]
    if not success:
        agg_table[(stage, model)] = {"quality": None, "latency": None, "cost": None, "count": len(items), "success": 0}
        continue
    qualities = [s["quality_score"] for s in success if s.get("quality_score") is not None]
    latencies = [s["latency_seconds"] for s in success]
    costs = [s.get("cost_usd", 0) for s in success]
    agg_table[(stage, model)] = {
        "quality": round(sum(qualities) / len(qualities), 1) if qualities else None,
        "latency": round(sum(latencies) / len(latencies), 3),
        "cost": round(sum(costs) / len(costs), 6),
        "count": len(items),
        "success": len(success),
    }

# === PER-STAGE MODEL COMPARISON ===
print("\n" + "=" * 70)
print("PHASE 1: Per-Stage Model Comparison (averaged over 9 questions)")
print("=" * 70)

for stage in STAGES:
    print(f"\n  {stage.upper()}:")
    stage_models = []
    for model in MODELS:
        a = agg_table.get((stage, model))
        if a:
            stage_models.append((model, a))
    stage_models.sort(key=lambda x: x[1].get("quality") or 0, reverse=True)
    for model, a in stage_models:
        q = a["quality"]
        l = a["latency"]
        c = a["cost"]
        s = a["success"]
        n = a["count"]
        marker = " <-- BASELINE" if BASELINE_MAP.get(stage) == model else ""
        print(f"    {model:15s}  quality={q:>6}  latency={l:>7}s  cost=${c:.6f}  ({s}/{n} ok){marker}")

# === BASELINE STATS ===
print("\n" + "=" * 70)
print("CURRENT BASELINE (gpt-5.2 + gpt-5.2-pro)")
print("=" * 70)

base_total_quality = 0
base_total_cost = 0
base_total_latency = 0
for stage in STAGES:
    model = BASELINE_MAP[stage]
    a = agg_table.get((stage, model), {})
    q = a.get("quality") or 0
    c = a.get("cost") or 0
    l = a.get("latency") or 0
    base_total_quality += q
    base_total_cost += c
    base_total_latency += l
    print(f"  {stage:15s} -> {model:15s}  quality={q}  cost=${c:.6f}  latency={l:.3f}s")

base_avg_quality = round(base_total_quality / len(STAGES), 1)
print(f"\n  TOTALS:  avg_quality={base_avg_quality}  cost/question=${base_total_cost:.6f}  latency/question={base_total_latency:.2f}s")

# === COMBO OPTIMIZATION ===
print("\n" + "=" * 70)
print(f"PHASE 2: Combo Optimization ({len(MODELS)}^{len(STAGES)} = {len(MODELS)**len(STAGES)} combos)")
print("=" * 70)

# Gather normalization ranges
all_q = [a["quality"] for a in agg_table.values() if a["quality"] is not None]
all_c = [a["cost"] for a in agg_table.values() if a["cost"] is not None]
all_l = [a["latency"] for a in agg_table.values() if a["latency"] is not None]
q_min, q_max = (min(all_q), max(all_q)) if all_q else (0, 1)
c_min, c_max = (min(all_c), max(all_c)) if all_c else (0, 1)
l_min, l_max = (min(all_l), max(all_l)) if all_l else (0, 1)

W_Q, W_C, W_L = 0.5, 0.3, 0.2

def norm(val, vmin, vmax):
    if vmax == vmin:
        return 1.0
    return (val - vmin) / (vmax - vmin)

combos = []
for assignment in itertools.product(MODELS, repeat=len(STAGES)):
    combo_map = dict(zip(STAGES, assignment))
    tot_q = tot_c = tot_l = 0
    valid = True
    for stage, model in combo_map.items():
        a = agg_table.get((stage, model))
        if not a or a["quality"] is None:
            valid = False
            break
        tot_q += a["quality"]
        tot_c += a["cost"] or 0
        tot_l += a["latency"] or 0
    if not valid:
        continue

    avg_q = tot_q / len(STAGES)
    nq = norm(avg_q, q_min, q_max)
    nc = 1.0 - norm(tot_c, c_min * len(STAGES), c_max * len(STAGES)) if c_max > c_min else 1.0
    nl = 1.0 - norm(tot_l, l_min * len(STAGES), l_max * len(STAGES)) if l_max > l_min else 1.0
    score = W_Q * nq + W_C * nc + W_L * nl

    combos.append({
        "assignment": combo_map,
        "avg_quality": round(avg_q, 1),
        "cost": round(tot_c, 6),
        "latency": round(tot_l, 2),
        "score": round(score, 4),
    })

combos.sort(key=lambda c: c["score"], reverse=True)

# Find special combos
cheapest = min(combos, key=lambda c: c["cost"])
fastest = min(combos, key=lambda c: c["latency"])
best_q = max(combos, key=lambda c: c["avg_quality"])

def show_combo(label, combo, rank=None):
    a = combo["assignment"]
    cost_save = ((base_total_cost - combo["cost"]) / base_total_cost * 100) if base_total_cost else 0
    lat_save = ((base_total_latency - combo["latency"]) / base_total_latency * 100) if base_total_latency else 0
    q_diff = combo["avg_quality"] - base_avg_quality
    rank_str = f" (Rank #{rank})" if rank else ""
    print(f"\n  {label}{rank_str}:")
    print(f"    Score: {combo['score']:.4f}")
    print(f"    Quality: {combo['avg_quality']}  (vs baseline: {q_diff:+.1f})")
    print(f"    Cost/Q:  ${combo['cost']:.6f}  (vs baseline: {cost_save:+.1f}%)")
    print(f"    Latency: {combo['latency']:.2f}s  (vs baseline: {lat_save:+.1f}%)")
    print(f"    Assignment:")
    for s in STAGES:
        marker = " *" if a[s] != BASELINE_MAP[s] else ""
        print(f"      {s:15s} -> {a[s]}{marker}")

show_combo("BEST OVERALL (weighted)", combos[0], 1)
show_combo("CHEAPEST PER QUESTION", cheapest)
show_combo("FASTEST PER QUESTION", fastest)
show_combo("HIGHEST QUALITY", best_q)

# === TOP 15 TABLE ===
print(f"\n  TOP 15 COMBOS (out of {len(combos)}):")
header = f"  {'#':<4} {'Score':<8} {'Quality':<9} {'Cost/Q':<12} {'Latency':<10} {'cls':>10} {'exp':>10} {'loc':>10} {'ref':>10} {'syn':>10} {'ver':>10}"
print(header)
print(f"  {'-'*4} {'-'*8} {'-'*9} {'-'*12} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*10}")
for i, c in enumerate(combos[:15], 1):
    a = c["assignment"]
    print(f"  {i:<4} {c['score']:<8.4f} {c['avg_quality']:<9} ${c['cost']:<11.6f} {c['latency']:<10.2f} {a['classification']:>10} {a['expansion']:>10} {a['location']:>10} {a['reflection']:>10} {a['synthesis']:>10} {a['verification']:>10}")

# Save final report
report = {
    "baseline": {
        "assignment": BASELINE_MAP,
        "avg_quality": base_avg_quality,
        "cost_per_question": base_total_cost,
        "latency_per_question": base_total_latency,
    },
    "per_stage_aggregated": {f"{s}|{m}": agg_table.get((s, m)) for s in STAGES for m in MODELS},
    "top_combos": combos[:50],
    "total_combos": len(combos),
    "special": {
        "overall_best": combos[0] if combos else None,
        "cheapest": cheapest,
        "fastest": fastest,
        "best_quality": best_q,
    },
}
merged["report"] = report
with open("experiment_results.json", "w", encoding="utf-8") as f:
    json.dump(merged, f, indent=2, default=str)

print("\n" + "=" * 70)
print("DONE. Full results in experiment_results.json")
print("=" * 70)
