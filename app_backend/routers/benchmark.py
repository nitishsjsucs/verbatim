"""LLM Benchmark API router.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
"""
import json

from fastapi import APIRouter, HTTPException, Query

from app_backend.models.schemas import (
    LLMBenchmarkRunRequest, TournamentBattleRequest, ModelExperimentRequest,
)

router = APIRouter(prefix="/admin/llm-benchmark", tags=["llm-benchmark"])


@router.get("/models")
def llm_benchmark_models():
    """List all available models for benchmarking."""
    from utils.llm_benchmark import (
        AVAILABLE_MODELS, BENCHMARK_MODELS, MODEL_PRICING,
        STAGE_META, TEST_QUESTIONS, PipelineStage, CURRENT_BASELINE,
    )
    return {
        "models": AVAILABLE_MODELS,
        "benchmark_models": BENCHMARK_MODELS,
        "pricing": MODEL_PRICING,
        "stages": [
            {"id": s.value, "label": STAGE_META[s]["label"], "default_model": STAGE_META[s]["default_model"]}
            for s in PipelineStage
        ],
        "test_questions": TEST_QUESTIONS,
        "current_baseline": {s.value: m for s, m in CURRENT_BASELINE.items()},
    }


@router.post("/run")
def llm_benchmark_run(req: LLMBenchmarkRunRequest):
    """
    Run an LLM benchmark batch.  This is synchronous and may take several minutes.
    
    Returns all individual results + aggregated per-stage per-model comparisons.
    """
    from utils.llm_benchmark import (
        BenchmarkRunner,
        BenchmarkResultStore,
        PipelineStage,
        TEST_QUESTIONS,
    )

    runner = BenchmarkRunner()

    # Resolve stages
    if req.stages:
        try:
            stages = [PipelineStage(s) for s in req.stages]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid stage: {e}")
    else:
        stages = list(PipelineStage)

    # Resolve models
    models = req.models if req.models else ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"]

    # Resolve questions
    if req.question_ids:
        questions = [q for q in TEST_QUESTIONS if q["id"] in req.question_ids]
        if not questions:
            raise HTTPException(status_code=400, detail="No matching question IDs")
    else:
        questions = TEST_QUESTIONS

    # Run the benchmark
    summary = runner.run_batch(stages, models, questions)

    # Store in MongoDB
    try:
        store = BenchmarkResultStore()
        run_id = store.save_run(summary)
        summary["run_id"] = str(run_id)
    except Exception as e:
        summary["run_id"] = None
        summary["storage_error"] = str(e)

    # MongoDB insert_one mutates dict in-place adding _id as ObjectId
    summary.pop("_id", None)

    return summary


@router.post("/tournament-battle")
def llm_benchmark_tournament_battle(req: TournamentBattleRequest):
    """
    Run a tournament battle: all models compete on one stage × one question.
    GPT-5.2-pro (high reasoning) judges the outputs.
    
    Designed for incremental calls from the UI — one battle per HTTP request.
    """
    from utils.llm_benchmark import (
        BenchmarkRunner, PipelineStage, TEST_QUESTIONS, BENCHMARK_MODELS,
    )

    try:
        stage = PipelineStage(req.stage)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {req.stage}")

    question = next((q for q in TEST_QUESTIONS if q["id"] == req.question_id), None)
    if not question:
        raise HTTPException(status_code=400, detail=f"Unknown question_id: {req.question_id}")

    models = req.models if req.models else [m["id"] for m in BENCHMARK_MODELS]

    runner = BenchmarkRunner()
    battle = runner.tournament_battle(stage, models, question)

    # Clean any ObjectId that might have snuck in
    cleaned = json.loads(json.dumps(battle, default=str))

    return cleaned


@router.get("/results")
def llm_benchmark_results(limit: int = Query(20, ge=1, le=100)):
    """List recent LLM benchmark runs (metadata only)."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    return {"runs": store.list_runs(limit)}


@router.get("/results/{run_id}")
def llm_benchmark_result_detail(run_id: str):
    """Get full results for a specific benchmark run."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    result = store.get_run(run_id)
    if not result:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
    return result


@router.get("/latest")
def llm_benchmark_latest():
    """Get the most recent benchmark run results."""
    from utils.llm_benchmark import BenchmarkResultStore
    store = BenchmarkResultStore()
    result = store.get_latest()
    if not result:
        return {"message": "No benchmark runs yet"}
    return result


@router.post("/experiment")
def llm_benchmark_experiment(req: ModelExperimentRequest):
    """
    Run a full model optimization experiment.

    Tests gpt-5.2 vs gpt-5-mini vs gpt-5-nano across all 6 QA pipeline stages,
    then computes the optimal model assignment per stage to minimize cost and
    latency while maintaining quality.

    WARNING: This is synchronous and runs 3 models × 6 stages × N questions
    = 18×N LLM calls.  With 5 default questions that's 90 calls (~5-15 min).
    """
    from utils.llm_benchmark import (
        ModelExperiment, BenchmarkResultStore,
        BENCHMARK_MODELS, TEST_QUESTIONS,
    )

    experiment = ModelExperiment()

    # Resolve models
    models = req.models if req.models else [m["id"] for m in BENCHMARK_MODELS]

    # Resolve questions
    if req.questions:
        questions = req.questions
    elif req.question_ids:
        questions = [q for q in TEST_QUESTIONS if q["id"] in req.question_ids]
        if not questions:
            raise HTTPException(status_code=400, detail="No matching question IDs")
    else:
        questions = TEST_QUESTIONS

    # Run
    result = experiment.run_experiment(
        questions=questions,
        models=models,
        quality_weight=req.quality_weight,
        cost_weight=req.cost_weight,
        latency_weight=req.latency_weight,
    )

    # Store in MongoDB
    try:
        store = BenchmarkResultStore()
        run_id = store.save_run(result)
        result["run_id"] = str(run_id)
    except Exception as e:
        result["run_id"] = None
        result["storage_error"] = str(e)

    # MongoDB insert_one mutates dict in-place adding _id as ObjectId
    result.pop("_id", None)

    return result
