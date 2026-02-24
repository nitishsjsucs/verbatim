# FIX #1: Eliminate Dependency Injection Antipattern

## File: `app_backend/main.py`

Replace the current dependency functions (lines ~200-230) with singleton pattern.

### Current Code (REMOVE):
```python
def get_tree_store():
    return TreeStore()

def get_qa_engine():
    return QAEngine()

def get_ingestion_pipeline():
    return IngestionPipeline()

def get_query_store():
    return QueryStore()

def get_corpus_store():
    return CorpusStore()

def get_corpus_qa_engine():
    return CorpusQAEngine()

def get_actionable_store():
    return ActionableStore()

def get_actionable_extractor():
    return ActionableExtractor()

def get_conversation_store():
    return ConversationStore()
```

### New Code (REPLACE WITH):
```python
# ---------------------------------------------------------------------------
# Singleton Initialization
# ---------------------------------------------------------------------------

_tree_store: Optional[TreeStore] = None
_qa_engine: Optional[QAEngine] = None
_ingestion_pipeline: Optional[IngestionPipeline] = None
_query_store: Optional[QueryStore] = None
_corpus_store: Optional[CorpusStore] = None
_corpus_qa_engine: Optional[CorpusQAEngine] = None
_actionable_store: Optional[ActionableStore] = None
_actionable_extractor: Optional[ActionableExtractor] = None
_conversation_store: Optional[ConversationStore] = None


def _init_singletons():
    """Initialize all singletons once at startup."""
    global _tree_store, _qa_engine, _ingestion_pipeline, _query_store
    global _corpus_store, _corpus_qa_engine, _actionable_store
    global _actionable_extractor, _conversation_store
    
    logger.info("Initializing backend singletons...")
    
    _tree_store = TreeStore()
    logger.info("  ✓ TreeStore initialized")
    
    _qa_engine = QAEngine()
    logger.info("  ✓ QAEngine initialized")
    
    _ingestion_pipeline = IngestionPipeline()
    logger.info("  ✓ IngestionPipeline initialized")
    
    _query_store = QueryStore()
    logger.info("  ✓ QueryStore initialized")
    
    _corpus_store = CorpusStore()
    logger.info("  ✓ CorpusStore initialized")
    
    _corpus_qa_engine = CorpusQAEngine()
    logger.info("  ✓ CorpusQAEngine initialized")
    
    _actionable_store = ActionableStore()
    logger.info("  ✓ ActionableStore initialized")
    
    _actionable_extractor = ActionableExtractor()
    logger.info("  ✓ ActionableExtractor initialized")
    
    _conversation_store = ConversationStore()
    logger.info("  ✓ ConversationStore initialized")
    
    logger.info("All singletons initialized successfully")


def get_tree_store() -> TreeStore:
    return _tree_store


def get_qa_engine() -> QAEngine:
    return _qa_engine


def get_ingestion_pipeline() -> IngestionPipeline:
    return _ingestion_pipeline


def get_query_store() -> QueryStore:
    return _query_store


def get_corpus_store() -> CorpusStore:
    return _corpus_store


def get_corpus_qa_engine() -> CorpusQAEngine:
    return _corpus_qa_engine


def get_actionable_store() -> ActionableStore:
    return _actionable_store


def get_actionable_extractor() -> ActionableExtractor:
    return _actionable_extractor


def get_conversation_store() -> ConversationStore:
    return _conversation_store
```

### Add this event handler (around line 60, after CORS setup):
```python
@app.on_event("startup")
async def startup_event():
    """Initialize all singletons on app startup."""
    _init_singletons()
```

---

# FIX #2: Skip Query Expansion for Single-Hop Queries

## File: `retrieval/router.py`

Modify the retrieve() method to skip expansion for single-hop queries (lines ~74-100).

### Current Code (LINES 74-100):
```python
    # Step 2: Expand query (multi-query generation for broad queries)
    logger.info("[Retrieval 2/6] Expanding query...")
    t0 = time.time()
    expanded_queries = self._expander.expand(query)
    expand_time = time.time() - t0
    if expanded_queries:
        logger.info("  -> %d expanded queries generated (%.1fs)", len(expanded_queries), expand_time)
    else:
        logger.info("  -> No expansion (query type: %s) (%.1fs)", query.query_type.value, expand_time)
```

### New Code (REPLACE WITH):
```python
    # Step 2: Expand query (only for broad queries)
    logger.info("[Retrieval 2/6] Expanding query (if needed)...")
    t0 = time.time()
    expanded_queries = []
    
    # Only expand for multi_hop and global queries
    if query.query_type.value in ("multi_hop", "global"):
        expanded_queries = self._expander.expand(query)
        expand_time = time.time() - t0
        if expanded_queries:
            logger.info("  -> %d expanded queries generated (%.1fs)", len(expanded_queries), expand_time)
        else:
            logger.info("  -> No expansion generated (%.1fs)", expand_time)
    else:
        expand_time = time.time() - t0
        logger.info("  -> Skipped for %s query (%.1fs)", query.query_type.value, expand_time)
```

---

# FIX #3: Reflection Early Termination

## File: `retrieval/retrieval_reflector.py`

Modify the reflect_and_fill() method (around line 60-130) to add early termination heuristics.

### Add these imports at the top:
```python
from models.query import QueryType
```

### Replace reflect_and_fill() method starting at line 60:
```python
    def reflect_and_fill(
        self,
        query: Query,
        sections: list[RetrievedSection],
        tree: DocumentTree,
        router: object,  # StructuralRouter — avoided circular import via duck typing
    ) -> list[RetrievedSection]:
        """
        Check evidence sufficiency and fill gaps if needed.

        Skips reflection for definitional queries (they're precise enough)
        and for high-confidence retrievals (with rich evidence).

        Args:
            query: The classified user query.
            sections: Already-retrieved sections.
            tree: The document tree.
            router: The StructuralRouter (for gap-filling retrieval).
                    Must have a `retrieve_for_subquery(text, tree)` method.

        Returns:
            Augmented sections list (original + gap-filled).
        """
        import time

        # Track contribution metrics
        initial_section_count = len(sections)
        initial_node_ids = {s.node_id for s in sections}
        initial_token_count = sum(s.token_count for s in sections)
        round_details: list[dict] = []

        # Skip reflection for definitional queries — they're focused enough
        if query.query_type == QueryType.DEFINITIONAL:
            logger.info("Skipping reflection for definitional query")
            logger.info(
                "[Reflection Contribution] SKIPPED — definitional query. "
                "Sections: %d, Tokens: %d",
                initial_section_count,
                initial_token_count,
            )
            return sections

        # Skip if too few sections (nothing to reflect on)
        if len(sections) < 2:
            logger.info("Skipping reflection — too few sections (%d)", len(sections))
            logger.info(
                "[Reflection Contribution] SKIPPED — too few sections (%d). "
                "Tokens: %d",
                len(sections),
                initial_token_count,
            )
            return sections

        # ** NEW: Early termination for high-confidence evidence **
        # If we already have high-quality evidence, skip reflection entirely
        avg_section_confidence = (
            sum(getattr(s, "confidence", 0.8) for s in sections) / len(sections)
            if sections
            else 0
        )
        total_tokens = sum(s.token_count for s in sections)
        located_count = sum(1 for s in sections if s.source == "direct")

        # Heuristic: if evidence is rich AND high-confidence, skip reflection
        should_skip_for_quality = (
            avg_section_confidence >= 0.85
            and total_tokens >= 15000
            and located_count >= 8
        )

        if should_skip_for_quality:
            logger.info(
                "Early termination: high-quality evidence detected. "
                "Confidence: %.2f, Tokens: %d, Direct sections: %d",
                avg_section_confidence,
                total_tokens,
                located_count,
            )
            logger.info("[Reflection Contribution] SKIPPED — high-quality evidence")
            return sections

        # Otherwise run reflection loop (identical to original code)...
        for round_num in range(1, _MAX_REFLECTION_ROUNDS + 1):
            # ... [REST OF ORIGINAL METHOD UNCHANGED] ...
```

---

# FIX #4: Batch Synthesis + Verification

## File: `agents/synthesizer.py`

Modify the synthesize() method to optionally include verification in the LLM call.

### Add this import:
```python
from typing import Tuple
```

### Add this method to the Synthesizer class:
```python
    def synthesize(
        self,
        query: Query,
        sections: list[RetrievedSection],
        verify: bool = True,
    ) -> Answer:
        """
        Synthesize an answer from retrieved sections.
        Optionally includes verification in the same LLM call.

        Args:
            query: The classified query.
            sections: Retrieved document sections with text.
            verify: If True, include verification in the LLM prompt.

        Returns:
            An Answer object with text, citations, verification status, and inferred points.
        """
        if not sections:
            return Answer(
                text="No relevant sections were found to answer this query.",
                query_type=query.query_type,
            )

        prompt_data = load_prompt("answering", "synthesis")
        system_prompt = prompt_data["system"]
        
        # Choose the appropriate user template
        if verify:
            # Use template with verification instructions
            user_template = prompt_data.get(
                "user_template_with_verification", 
                prompt_data["user_template"]
            )
            # Ensure system prompt includes verification task
            system_prompt = system_prompt + "\n\n[VERIFICATION TASK]\nAfter generating the answer, verify its accuracy by checking each claim against the source text."
        else:
            user_template = prompt_data["user_template"]

        # Build the retrieved text block for the prompt
        retrieved_text = self._format_sections(sections)

        user_msg = format_prompt(
            user_template,
            query_text=query.text,
            query_type=query.query_type.value,
            retrieved_text=retrieved_text,
        )

        start = time.time()

        try:
            # Adaptive reasoning effort based on query complexity
            _effort_map = {
                "definitional": "medium",
                "single_hop": "medium",
                "multi_hop": "high",
                "global": "high",
            }
            effort = _effort_map.get(query.query_type.value, "medium")

            # Use chat_json_with_status to detect API-level truncation
            result, was_truncated = self._llm.chat_json_with_status(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                model=self._settings.llm.model_pro,
                max_tokens=self._settings.llm.max_tokens_long,
                reasoning_effort=effort,
            )

            elapsed = time.time() - start

            # Parse the answer
            answer_text = result.get("answer_text", "")
            if not answer_text:
                answer_text = result.get("answer", result.get("text", str(result)))

            # --- Truncation handling ---
            needs_continuation = was_truncated or self._is_truncated(answer_text)

            if needs_continuation:
                answer_text, continuation_results = self._handle_truncation_iterative(
                    answer_text, system_prompt, user_msg, max_rounds=3
                )
                for cont_result in continuation_results:
                    for key in ("citations", "inferred_points"):
                        extras = cont_result.get(key, [])
                        if extras:
                            existing = result.get(key, [])
                            existing.extend(extras)
                            result[key] = existing

            # Parse citations
            citations = []
            for c in result.get("citations", []):
                node_id = c.get("node_id", "")
                page_range = ""
                for s in sections:
                    if s.node_id == node_id:
                        page_range = s.page_range
                        break

                citations.append(
                    Citation(
                        citation_id=c.get("citation_id", f"[{node_id}]"),
                        node_id=node_id,
                        title=c.get("title", ""),
                        page_range=page_range,
                        excerpt=c.get("excerpt", ""),
                    )
                )

            # Parse inferred points
            inferred_points = []
            for ip in result.get("inferred_points", []):
                if not ip.get("point"):
                    continue
                confidence = str(ip.get("confidence", "medium"))
                if confidence not in ("high", "medium", "low"):
                    confidence = "medium"
                raw_defs = ip.get("supporting_definitions", [])
                if isinstance(raw_defs, str):
                    raw_defs = [raw_defs]
                supporting_defs = [str(d) for d in raw_defs if d]
                raw_secs = ip.get("supporting_sections", [])
                if isinstance(raw_secs, str):
                    raw_secs = [raw_secs]
                supporting_secs = [str(s) for s in raw_secs if s]
                inferred_points.append(
                    InferredPoint(
                        point=str(ip["point"]),
                        supporting_definitions=supporting_defs,
                        supporting_sections=supporting_secs,
                        reasoning=str(ip.get("reasoning", "")),
                        confidence=confidence,
                    )
                )

            answer = Answer(
                text=answer_text,
                citations=citations,
                inferred_points=inferred_points,
                query_type=query.query_type,
                retrieved_sections=sections,
            )

            # ** Apply verification results if included in response **
            if verify and "verification_status" in result:
                self._apply_verification_from_response(answer, result)

            logger.info(
                "Synthesis complete: %d citations, %d inferred points, %.1fs",
                len(citations),
                len(inferred_points),
                elapsed,
            )

            return answer

        except Exception as e:
            logger.error("Synthesis failed: %s", str(e))
            return Answer(
                text=f"Error generating answer: {str(e)}",
                query_type=query.query_type,
                retrieved_sections=sections,
            )

    def _apply_verification_from_response(
        self, answer: Answer, verification_data: dict
    ) -> None:
        """Apply verification status from synthesis response."""
        status = verification_data.get("verification_status", "unverified")
        accuracy_score = float(verification_data.get("factual_accuracy_score", 0.0))
        completeness = float(verification_data.get("completeness_score", 0.0))
        issues = verification_data.get("issues", [])

        critical_issues = [
            i
            for i in issues
            if i.get("type")
            in ("unsupported_claim", "fabricated_claim", "invalid_inference")
        ]

        if status == "verified" or (accuracy_score >= 0.8 and not critical_issues):
            answer.verified = True
            answer.verification_status = "verified"
        elif accuracy_score >= 0.6:
            answer.verified = False
            answer.verification_status = "partially_verified"
        else:
            answer.verified = False
            answer.verification_status = "unverified"

        notes_parts = []
        notes_parts.append(
            f"Accuracy: {accuracy_score:.0%}, Completeness: {completeness:.0%}"
        )
        if issues:
            notes_parts.append(f"Issues found: {len(issues)}")
            for i, issue in enumerate(issues[:3], 1):
                issue_type = issue.get("type", "unknown")
                claim = issue.get("claim", "")[:80]
                notes_parts.append(f"  {i}. [{issue_type}] {claim}")

        answer.verification_notes = "\n".join(notes_parts)
```

### Modify QAEngine to pass verify flag to synthesize():

In [agents/qa_engine.py](agents/qa_engine.py#L164), change:

**Before:**
```python
        else:
            logger.info("[QA 4/6] Synthesizing answer...")
            answer = self._synthesizer.synthesize(query, sections)
        timings["4_synthesis"] = time.time() - t0
```

**After:**
```python
        else:
            logger.info("[QA 4/6] Synthesizing answer (with verification: %s)...", verify)
            answer = self._synthesizer.synthesize(query, sections, verify=verify)
        timings["4_synthesis"] = time.time() - t0
```

And remove the separate verification step in synthesize_and_verify():

**Before:**
```python
        # Step 5: Verify
        t0 = time.time()
        if verify:
            logger.info("[QA 5/6] Verifying answer...")
            answer = self._verifier.verify(answer, query_text=query_text)
        else:
            logger.info("[QA 5/6] Skipping verification")
            answer.verification_status = "skipped"
        timings["5_verification"] = time.time() - t0
```

**After:**
```python
        # Step 5: Verification (now combined in synthesis)
        # No separate verification step needed
        if not verify:
            logger.info("[QA 5/6] Verification was skipped in synthesis")
            answer.verification_status = "skipped"
        timings["5_verification"] = 0.0  # Combined with synthesis
```

---

# FIX #5: MongoDB Batch Reads for Document Listing

## File: `tree/tree_store.py`

Add a new method for batch loading document summaries (without N+1 pattern).

### Add this method to TreeStore class:
```python
    def list_documents_summary(self) -> List[dict]:
        """
        Load all document summaries in a single MongoDB query.
        Returns only essential metadata (no full tree structure).
        
        This avoids the N+1 query pattern where each document required a separate load().
        """
        results = []
        try:
            # Project only needed fields to reduce network payload
            cursor = self._collection.find(
                {},  # All documents
                {
                    "_id": 1,
                    "doc_name": 1,
                    "doc_description": 1,
                    "total_pages": 1,
                    "node_count": 1,
                }
            )
            
            for doc in cursor:
                results.append({
                    "id": doc["_id"],
                    "name": doc.get("doc_name", ""),
                    "pages": doc.get("total_pages", 0),
                    "nodes": doc.get("node_count", 0),
                    "description": doc.get("doc_description", ""),
                })
            
            logger.info("Loaded summaries for %d documents in single query", len(results))
            return results
            
        except Exception as e:
            logger.error("Failed to list document summaries: %s", str(e))
            return []
```

### File: `app_backend/main.py`

Replace the /documents endpoint to use the new batch method (around line 280):

**Before:**
```python
@app.get("/documents")
def list_documents():
    """List all indexed documents."""
    store = get_tree_store()
    doc_ids = store.list_trees()
    docs = []
    for doc_id in doc_ids:
        tree = store.load(doc_id)  # N separate queries!
        if tree:
            docs.append(
                {
                    "id": tree.doc_id,
                    "name": tree.doc_name,
                    "pages": tree.total_pages,
                    "nodes": tree.node_count,
                    "description": tree.doc_description,
                }
            )
    return docs
```

**After:**
```python
@app.get("/documents")
def list_documents():
    """List all indexed documents (batch loaded for efficiency)."""
    store = get_tree_store()
    return store.list_documents_summary()
```

---

# FIX #6: MongoDB Connection Pooling

## File: `utils/mongo.py`

Update the MongoManager._initialize() method to configure connection pooling.

### Replace the _initialize() method:
```python
    def _initialize(self):
        settings = get_settings()
        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        db_name = os.getenv("MONGO_DB_NAME", "govinda_v2")

        try:
            # Connection pool configuration
            common_kwargs = {
                "maxPoolSize": 50,  # Max 50 connections in pool
                "minPoolSize": 5,   # Keep 5 warm
                "maxIdleTimeMS": 45000,  # Close idle connections after 45s
                "serverSelectionTimeoutMS": 10000,  # Timeout for server discovery
                "connectTimeoutMS": 10000,
                "retryWrites": True,  # Enable retry logic for transient failures
            }
            
            # Atlas (mongodb+srv) requires server_api for stable API
            if mongo_uri.startswith("mongodb+srv"):
                from pymongo.server_api import ServerApi
                self._client = MongoClient(
                    mongo_uri,
                    server_api=ServerApi("1"),
                    tls=True,
                    tlsAllowInvalidCertificates=False,
                    **common_kwargs,
                )
            else:
                self._client = MongoClient(mongo_uri, **common_kwargs)

            self._db = self._client[db_name]
            self._fs = gridfs.GridFS(self._db)
            self._client.admin.command("ping")
            
            logger.info(
                f"Connected to MongoDB: {db_name} "
                f"(pool: min={common_kwargs['minPoolSize']}, "
                f"max={common_kwargs['maxPoolSize']})"
            )
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise e
```

---

# Implementation Checklist

- [ ] **FIX #1**: Singleton initialization in main.py
  - [ ] Replace get_* functions with global singletons
  - [ ] Add @app.on_event("startup") to call _init_singletons()
  - [ ] Add type hints to get_* functions

- [ ] **FIX #2**: Query expansion gating in router.py
  - [ ] Check query.query_type.value before calling expand()
  - [ ] Update logging to indicate when expansion is skipped

- [ ] **FIX #3**: Reflection early termination
  - [ ] Calculate avg_section_confidence and total_tokens
  - [ ] Add should_skip_for_quality heuristic
  - [ ] Update logs with early termination info

- [ ] **FIX #4**: Batch synthesis + verification
  - [ ] Add verify parameter to synthesize()
  - [ ] Add _apply_verification_from_response() method
  - [ ] Update QAEngine to pass verify flag
  - [ ] Remove separate Verifier call

- [ ] **FIX #5**: Batch document loading
  - [ ] Add list_documents_summary() to TreeStore
  - [ ] Update /documents endpoint to use batch method

- [ ] **FIX #6**: Connection pooling
  - [ ] Configure maxPoolSize=50, minPoolSize=5 in MongoManager
  - [ ] Add retryWrites=True for resilience

