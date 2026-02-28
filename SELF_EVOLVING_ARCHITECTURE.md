# GOVINDA V2 — Self-Evolving Architecture Blueprint

## The Problem

Right now, GOVINDA is **stateless between queries**. Every question starts from scratch:
- The full tree index is dumped to the LLM (spray and pray)
- No memory of what worked before, what users actually needed, or what sections were useful
- Feedback is collected but never read back
- Conversations exist but don't inform retrieval
- The system doesn't get smarter — query #1000 is answered with the same strategy as query #1

## The Vision: A System That Learns

After integration, GOVINDA will have **5 learning loops** that compound over time:

```
                    ┌──────────────────────────────────────────────────┐
                    │              GOVINDA SELF-EVOLVING               │
                    │                                                  │
 User Query ──────►│  ┌─────────┐   ┌──────────┐   ┌──────────────┐  │
                    │  │ Memory  │──►│ Smart    │──►│ Synthesis +  │  │
                    │  │ Recall  │   │ Retrieval│   │ Verification │  │
                    │  └────┬────┘   └────┬─────┘   └──────┬───────┘  │
                    │       │             │                 │          │
                    │  ┌────▼─────────────▼─────────────────▼──────┐  │
                    │  │           LEARNING LOOPS                   │  │
                    │  │                                            │  │
                    │  │  Loop 1: Node Heat Map (RAPTOR-inspired)  │  │
                    │  │  Loop 2: User Memory (MemoryOS)           │  │
                    │  │  Loop 3: Query Intelligence (SimpleMem)   │  │
                    │  │  Loop 4: Retrieval Feedback (memU)        │  │
                    │  │  Loop 5: Hybrid Search Fallback (R2R)     │  │
                    │  └───────────────────────────────────────────┘  │
                    └──────────────────────────────────────────────────┘
```

---

## Architecture: What Each System Contributes

### System Role Map

| System | Role in GOVINDA | What It Replaces/Augments | Key Benefit |
|--------|----------------|--------------------------|-------------|
| **RAPTOR** | Multi-resolution node summaries + retrieval pre-filter | Spray-and-pray full index dump | Queries hit the right abstraction level; 70%+ fewer tokens to Locator |
| **MemoryOS** | Per-user memory (preferences, past interactions, profile) | Nothing (new capability) | Personalized answers, conversation continuity, user-aware retrieval |
| **SimpleMem** | Query-level intelligence (what worked, patterns, facts) | In-memory query cache | Persistent retrieval intelligence that survives restarts |
| **memU** | Retrieval quality feedback loop (which nodes were cited) | Nothing (feedback is write-only today) | System learns which sections matter for which query types |
| **R2R** | Hybrid vector+fulltext search fallback + knowledge graph | Optional embedding pre-filter | Catches what LLM-only retrieval misses; entity-relationship awareness |

---

## The 5 Learning Loops — Detailed Design

---

### Loop 1: RAPTOR Node Heat Map — "Know What Matters"

**Problem solved**: The Locator sends the ENTIRE tree index to the LLM every query. For a 200-page document, that's 3000+ tokens of irrelevant noise.

**How RAPTOR helps**: Build a multi-resolution summary tree on top of GOVINDA's existing document tree, plus track which nodes actually get cited.

#### Implementation

```
GOVINDA Document Tree (existing)          RAPTOR Overlay
─────────────────────────────────         ─────────────────
Root                                      Cluster Summary L2
├── Chapter 1                             ├── Theme A (clusters Ch1+Ch3)
│   ├── Section 1.1                       │   └── Sub-theme A.1
│   ├── Section 1.2                       └── Theme B (clusters Ch2+Ch4)
│   └── Section 1.3                           └── Sub-theme B.1
├── Chapter 2
│   ├── Section 2.1                       
│   └── Section 2.2                       Heat Map (learned)
├── Chapter 3                             ─────────────────
└── Chapter 4                             Section 1.2: heat=8.7 (cited 12x)
                                          Section 2.1: heat=6.3 (cited 8x)
                                          Section 4.1: heat=0.2 (cited 0x)
```

**New module**: `retrieval/raptor_index.py`

```python
class RaptorIndex:
    """
    RAPTOR-style multi-resolution index overlaid on DocumentTree.
    
    At ingestion time:
    1. Takes all leaf node summaries from the DocumentTree
    2. Clusters them using RAPTOR's UMAP+GMM algorithm
    3. Generates cluster summaries (abstractive, via LLM)
    4. Builds 2-3 layers of progressively abstract summaries
    5. Stores embeddings at every layer
    
    At query time:
    1. Collapsed retrieval: search ALL layers simultaneously
    2. Return candidate node_ids at the RIGHT abstraction level
    3. Feed only these candidates (not the full index) to the Locator
    
    Learning:
    - After each query, record which nodes were actually CITED
    - Build a heat map: node_id -> citation_count
    - Hot nodes get priority in future retrievals
    - Cold nodes (never cited) get deprioritized
    """
    
    def __init__(self, tree: DocumentTree):
        self.tree = tree
        self.raptor_tree = None      # RAPTOR Tree object
        self.heat_map = {}           # node_id -> {citations: int, last_cited: datetime, queries: [str]}
        self.cluster_map = {}        # raptor_node_id -> [govinda_node_ids]
    
    def build(self):
        """One-time: build RAPTOR layers from document tree nodes."""
        # Extract text from all leaf nodes
        # Run RAPTOR clustering + summarization
        # Map RAPTOR clusters back to GOVINDA node_ids
        pass
    
    def query(self, query_text: str, top_k: int = 30) -> list[str]:
        """Return candidate node_ids using multi-resolution search."""
        # Embed query
        # Collapsed tree retrieval across all RAPTOR layers
        # Map results back to GOVINDA node_ids
        # Boost by heat_map scores
        # Return top_k candidates
        pass
    
    def record_citation(self, node_id: str, query_text: str):
        """Learning: record that this node was cited in an answer."""
        if node_id not in self.heat_map:
            self.heat_map[node_id] = {"citations": 0, "last_cited": None, "queries": []}
        self.heat_map[node_id]["citations"] += 1
        self.heat_map[node_id]["last_cited"] = datetime.utcnow()
        self.heat_map[node_id]["queries"].append(query_text[:100])
```

**Integration point — Locator changes**:

```python
# BEFORE (current): send everything
tree_index = tree.to_index()  # 3000+ tokens

# AFTER: RAPTOR pre-filters to ~30 candidates, then Locator reasons over just those
raptor_candidates = raptor_index.query(query.text, top_k=30)
compressed_index = tree.to_index(node_ids=raptor_candidates)  # ~500 tokens
# Locator now reasons over 500 tokens instead of 3000 → faster, cheaper, more accurate
```

**Persistence**: Store in MongoDB collection `raptor_indexes` (one per doc_id):
```json
{
  "_id": "doc_abc123",
  "raptor_tree": { "layers": [...], "embeddings": [...] },
  "heat_map": { "0042": {"citations": 12, "last_cited": "2026-02-27T..."} },
  "built_at": "2026-02-27T...",
  "version": 1
}
```

---

### Loop 2: MemoryOS User Memory — "Know Who's Asking"

**Problem solved**: Every query is context-free. The system doesn't know:
- What the user has asked before across sessions
- What topics they care about
- Their expertise level or domain focus  
- Their preferred answer style (detailed vs. brief)

**How MemoryOS helps**: Its 3-tier biologically-inspired memory creates a persistent user model.

#### Architecture

```
Per-User Memory (MemoryOS)
──────────────────────────
SHORT-TERM (last 10 Q&A pairs)
│  "User asked about Section 4.2 penalties"
│  "User asked about compliance deadlines"
│  "User asked about reporting requirements"
│
├──► consolidation when full
│
MID-TERM (sessions, heat-ranked)
│  Session: "Compliance Deep-Dive" (heat=7.2)
│  │  - 5 Q&A pairs about penalty clauses
│  │  - Keywords: penalties, violations, enforcement
│  Session: "Reporting Overview" (heat=3.1)
│  │  - 2 Q&A pairs about quarterly reports
│
├──► promotion when heat > threshold
│
LONG-TERM (user profile + knowledge)
│  Profile: "Expert-level user focused on regulatory compliance,
│            prefers detailed answers with specific section citations,
│            frequently asks about enforcement mechanisms"
│  Knowledge: ["User works in legal compliance dept",
│              "User monitors 3 regulatory documents",
│              "User prefers answers citing exact clause numbers"]
```

**New module**: `memory/user_memory.py`

```python
class UserMemoryManager:
    """
    MemoryOS-powered per-user memory for GOVINDA.
    
    Integration points:
    1. BEFORE retrieval: inject user context into the Locator prompt
       - "This user focuses on compliance topics" → bias toward compliance sections
    2. BEFORE synthesis: inject user preferences into the Synthesizer prompt  
       - "User prefers detailed answers" → adjust verbosity
    3. AFTER each query: store the Q&A pair for consolidation
    4. CONVERSATION CONTINUITY: feed prior Q&A as context for follow-ups
    """
    
    def __init__(self, user_id: str):
        self.memo = Memoryos(
            user_id=user_id,
            openai_api_key=settings.OPENAI_API_KEY,
            data_storage_path="./memory_data",
            llm_model="gpt-4o-mini",  # cheap model for memory ops
            assistant_id="govinda_v2",
            short_term_capacity=10,
            mid_term_capacity=500,
            long_term_knowledge_capacity=50,
        )
    
    def get_user_context(self, query_text: str) -> dict:
        """Retrieve relevant memories + profile for this query."""
        context = self.memo.retriever.retrieve_context(
            user_query=query_text,
            user_id=self.user_id
        )
        return {
            "profile": self.memo.get_user_profile_summary(),
            "recent_pages": context.get("retrieved_pages", []),
            "user_knowledge": context.get("retrieved_user_knowledge", []),
            "short_term": self.memo.short_term_memory.get_recent(),
        }
    
    def record_interaction(self, query: str, answer: str):
        """Store this Q&A for memory consolidation."""
        self.memo.add_memory(user_input=query, agent_response=answer)
```

**Integration point — Locator prompt enhancement**:

```python
# In locator.py, add user context to the system prompt:
user_context = user_memory.get_user_context(query.text)

locator_prompt = f"""
You are analyzing a document tree to find relevant sections.

USER CONTEXT (what we know about this user):
- Profile: {user_context['profile']}
- Recent topics: {[p['page_keywords'] for p in user_context['recent_pages']]}
- They recently asked about: {[st['user_input'][:80] for st in user_context['short_term']]}

QUERY: {query.text}

DOCUMENT INDEX:
{compressed_index}

Select the most relevant sections...
"""
```

**Integration point — Conversation continuity**:

```python
# In qa_engine.py, before retrieval:
if conversation_id:
    recent_qa = user_memory.get_short_term_history()
    # Resolve coreferences: "What about the penalties?" → 
    # "What are the penalties in Section 4.2 of the RBI circular?"
    resolved_query = resolve_coreferences(query.text, recent_qa)
```

**Persistence**: File-based (MemoryOS default) under `./memory_data/users/{user_id}/`

---

### Loop 3: SimpleMem Query Intelligence — "Remember What Worked"

**Problem solved**: The semantic query cache is in-memory and lost on restart. More importantly, the system doesn't learn retrieval STRATEGIES — which node-selection patterns led to good answers.

**How SimpleMem helps**: Its 3-stage compression pipeline (extract → synthesize → retrieve) is perfect for building a persistent "retrieval playbook."

#### Architecture

```
Query Intelligence Store (SimpleMem)
────────────────────────────────────
Every completed query produces a "retrieval fact":

MEMORY ENTRY:
{
  "lossless_restatement": "For questions about penalty calculations in RBI 
   circulars, sections containing 'penal charges', 'interest rate penalty', 
   and annexure tables are most relevant. Nodes 0042, 0043, 0067 were cited.
   Verification score: 0.95. User rated 5/5.",
  "keywords": ["penalty", "calculation", "RBI", "penal charges"],
  "topic": "retrieval_strategy",
  "entities": ["Section 4.2", "Annexure III", "RBI/2024/circular"],
  "persons": [],
  "timestamp": "2026-02-27T10:30:00"
}
```

**New module**: `memory/query_intelligence.py`

```python
class QueryIntelligence:
    """
    SimpleMem-powered persistent query learning.
    
    After each query:
    1. Extract retrieval facts: which nodes were located, read, cited
    2. Record verification score + user feedback
    3. Build a searchable memory of "what works for what"
    
    Before each query:
    1. Search for similar past queries
    2. If found, bias retrieval toward historically successful nodes
    3. If found with high confidence, potentially skip verification
    """
    
    def __init__(self, doc_id: str):
        self.system = SimpleMemSystem(
            api_key=settings.OPENAI_API_KEY,
            model="gpt-4o-mini",
            db_path=f"./query_intelligence/{doc_id}",
        )
    
    def learn_from_query(self, record: QueryRecord):
        """Extract and store retrieval intelligence from a completed query."""
        # Build a structured retrieval fact
        cited_nodes = [c.section_id for c in record.answer.citations]
        located_nodes = [n.node_id for n in record.routing_log.located_nodes]
        uncited = set(located_nodes) - set(cited_nodes)
        
        fact = (
            f"Query type: {record.query_type}. "
            f"Query: '{record.query_text}'. "
            f"Key terms: {record.key_terms}. "
            f"Cited nodes: {cited_nodes}. "
            f"Located but NOT cited (wasted): {list(uncited)}. "
            f"Verification: {record.verification_status} "
            f"(accuracy={record.factual_accuracy_score}). "
            f"User feedback: {record.feedback_rating}/5. "
            f"Reflect helped: {record.reflect_added_sections > 0}. "
            f"Total time: {record.total_time_s:.1f}s."
        )
        
        self.system.add_dialogue(
            role="system",
            content=fact,
            timestamp=record.timestamp.isoformat()
        )
    
    def get_retrieval_hints(self, query_text: str) -> dict:
        """Search past query intelligence for retrieval guidance."""
        self.system.finalize()
        results = self.system.retriever.hybrid_retrieve(query_text)
        
        hints = {
            "suggested_nodes": [],      # nodes that worked before
            "avoid_nodes": [],          # nodes that were located but never cited
            "skip_reflection": False,   # if reflection never helped for this type
            "skip_verification": False, # if always verified clean
            "estimated_type": None,     # predicted query type
        }
        
        # Parse past facts to extract actionable hints
        for entry in results:
            text = entry.lossless_restatement
            # Extract cited nodes, verification patterns, etc.
            # ... parsing logic ...
        
        return hints
```

**Integration point — Smart retrieval in `qa_engine.py`**:

```python
# Before retrieval:
hints = query_intelligence.get_retrieval_hints(query.text)

if hints["suggested_nodes"]:
    # Boost these nodes in the Locator (they worked before for similar queries)
    locator_kwargs["boost_nodes"] = hints["suggested_nodes"]

if hints["skip_reflection"]:
    # Reflection never helped for this query type — skip it
    do_reflect = False

if hints["skip_verification"] and hints["confidence"] > 0.9:
    # Always verified clean for similar queries — inline verify only
    do_verify = False
```

**Persistence**: LanceDB + FTS via SimpleMem, stored under `./query_intelligence/{doc_id}/`

---

### Loop 4: memU Retrieval Feedback — "Grade Your Own Work"

**Problem solved**: The system doesn't know if its retrieval was GOOD. It locates 15 nodes but maybe only 3 get cited. It doesn't learn from this signal.

**How memU helps**: Its structured memory extraction (profile, event, knowledge, behavior, skill) maps perfectly to grading retrieval performance.

#### Architecture

```
Retrieval Feedback Store (memU)
───────────────────────────────
Memory Types Mapped to GOVINDA:

SKILL memories:
  "For multi-hop queries about regulatory timelines, the Planner should 
   generate sub-queries by entity (bank, regulator, deadline) rather than 
   by topic. This pattern cited 4.2x more sections on average."

BEHAVIOR memories:
  "When query classification returns 'global', reflection adds value 62%
   of the time. When 'single_hop', reflection adds value only 8% of the time."

KNOWLEDGE memories:
  "Section 0042 ('Penal Charges') is the most-cited section in doc_abc123,
   appearing in 34% of all queries. It cross-references Sections 0067 and 0089."

EVENT memories:
  "On 2026-02-20, user_legal_team asked 15 questions about compliance deadlines.
   12 of them required Annexure III. Pattern: deadline queries → Annexure III."
```

**New module**: `memory/retrieval_feedback.py`

```python
class RetrievalFeedback:
    """
    memU-powered retrieval quality tracking.
    
    After each query, extracts structured feedback:
    - Which nodes were located vs. cited (precision)
    - Which sub-queries found cited content (recall)
    - Whether reflection/verification added value
    - Time distribution across pipeline stages
    
    Stores as memU memories that evolve over time:
    - Contradictions are resolved (old patterns replaced)
    - Reinforced patterns get higher salience
    - Decayed patterns fade naturally
    """
    
    def __init__(self):
        self.service = MemoryService(
            llm_profiles={
                "default": {
                    "api_key": settings.OPENAI_API_KEY,
                    "chat_model": "gpt-4o-mini",
                },
                "embedding": {
                    "api_key": settings.OPENAI_API_KEY,
                    "embed_model": "text-embedding-3-small",
                }
            },
            database_config={
                "metadata_store": {
                    "provider": "sqlite",
                    "sqlite_path": "./feedback_memory.db"
                }
            },
            memorize_config={
                "memory_types": ["skill", "behavior", "knowledge", "event"],
            },
        )
    
    async def record_feedback(self, record: QueryRecord):
        """Extract and memorize retrieval quality signals."""
        cited = {c.section_id for c in record.answer.citations}
        located = {n.node_id for n in record.routing_log.located_nodes}
        
        precision = len(cited & located) / max(len(located), 1)
        wasted = located - cited
        
        feedback_text = json.dumps({
            "query_type": record.query_type,
            "query_text": record.query_text[:200],
            "doc_id": record.doc_id,
            "precision": round(precision, 2),
            "cited_nodes": list(cited),
            "wasted_nodes": list(wasted),
            "reflect_helped": record.reflect_added_sections > 0,
            "verification_status": record.verification_status,
            "user_rating": record.feedback_rating,
            "total_time_s": record.total_time_s,
            "stage_times": record.stage_timings,
        })
        
        # Write as a temp file and memorize
        await self.service.memorize(
            resource_url=self._write_feedback_file(feedback_text),
            modality="document",
        )
    
    async def get_performance_insights(self, query_type: str, doc_id: str) -> dict:
        """Retrieve learned performance patterns for this query type."""
        memories = await self.service.retrieve(
            queries=[{"role": "user", "content": f"retrieval performance for {query_type} queries on {doc_id}"}]
        )
        return self._parse_insights(memories)
```

**Integration point — Adaptive pipeline in `qa_engine.py`**:

```python
# Before each query, consult learned performance patterns:
insights = await retrieval_feedback.get_performance_insights(
    query_type=classification.query_type,
    doc_id=doc_id
)

# Dynamically adjust pipeline based on learned patterns:
if insights.get("avg_precision") < 0.3:
    # Retrieval quality is poor for this type → increase located nodes
    max_nodes = 20  # instead of default 15

if insights.get("reflect_value_rate") < 0.1:
    # Reflection almost never helps for this query type → skip
    do_reflect = False

if insights.get("best_sub_query_strategy"):
    # Use the learned sub-query decomposition strategy
    planner_hint = insights["best_sub_query_strategy"]
```

**Persistence**: SQLite via memU, auto-evolving via reinforcement + decay

---

### Loop 5: R2R Hybrid Search Fallback — "Catch What LLM Misses"

**Problem solved**: Vectorless retrieval depends entirely on the LLM's ability to match queries to section titles/summaries. When the section title is misleading or the query uses different terminology, the LLM misses relevant content.

**How R2R helps**: Its production-grade hybrid search (vector + fulltext + knowledge graph) provides a safety net.

#### Architecture

```
Query Flow (Augmented)
──────────────────────
                                    ┌─────────────────┐
                              ┌────►│ RAPTOR Pre-filter│──── RAPTOR candidates
                              │     └─────────────────┘
User Query ──► Classification │     ┌─────────────────┐
                              ├────►│ GOVINDA Locator  │──── LLM-reasoned nodes
                              │     └─────────────────┘
                              │     ┌─────────────────┐
                              └────►│ R2R Hybrid Search│──── Vector+FTS+KG nodes
                                    └─────────────────┘
                                            │
                              ┌─────────────▼──────────────┐
                              │     MERGE + RERANK          │
                              │  (union, deduplicate,       │
                              │   score by source count)    │
                              └─────────────────────────────┘
```

**New module**: `retrieval/r2r_fallback.py`

```python
class R2RFallback:
    """
    R2R-powered hybrid search as a retrieval safety net.
    
    At ingestion:
    1. Ingest the same document into R2R (chunked, embedded, KG-extracted)
    2. R2R builds: vector index + fulltext index + knowledge graph
    
    At query time:
    1. Run R2R hybrid search (semantic + fulltext + RRF fusion)
    2. Map R2R chunk results back to GOVINDA node_ids (via page numbers)
    3. Merge with Locator results — nodes found by BOTH get highest priority
    
    Learning:
    - R2R's knowledge graph captures entity relationships across the document
    - "Section 4.2 references Annexure III" is encoded as a graph edge
    - Queries about entities automatically pull in related sections
    """
    
    def __init__(self, r2r_base_url: str = "http://localhost:7272"):
        self.client = R2RClient(r2r_base_url)
        self.node_chunk_map = {}  # r2r_chunk_id -> govinda_node_id
    
    async def ingest_document(self, tree: DocumentTree, pdf_path: str):
        """Parallel ingest: GOVINDA tree + R2R chunks from same PDF."""
        # Upload PDF to R2R
        doc_response = await self.client.documents.create(
            file_path=pdf_path,
            ingestion_mode="hi-res",
        )
        
        # Build mapping: R2R chunks → GOVINDA nodes (by page overlap)
        chunks = await self.client.documents.list_chunks(doc_response.id)
        for chunk in chunks:
            # Map chunk to GOVINDA node by page range overlap
            node_id = tree.find_node_by_page(chunk.metadata.page_number)
            self.node_chunk_map[chunk.id] = node_id
    
    async def hybrid_search(self, query: str, doc_id: str, top_k: int = 20) -> list[str]:
        """Run R2R hybrid search, return GOVINDA node_ids."""
        results = await self.client.retrieval.search(
            query=query,
            search_mode="advanced",  # hybrid: semantic + fulltext + RRF
            search_settings={
                "limit": top_k,
                "filters": {"document_id": {"$eq": doc_id}},
            }
        )
        
        # Map R2R results back to GOVINDA node_ids
        node_ids = []
        for result in results.chunk_search_results:
            if result.chunk_id in self.node_chunk_map:
                node_ids.append(self.node_chunk_map[result.chunk_id])
        
        return list(set(node_ids))
    
    async def get_entity_relations(self, entity: str) -> list[dict]:
        """Query R2R knowledge graph for entity relationships."""
        graph_results = await self.client.retrieval.search(
            query=entity,
            search_settings={"graph_settings": {"enabled": True}},
        )
        return graph_results.graph_search_results
```

**Integration point — Merged retrieval in `router.py`**:

```python
# Run both retrievals in parallel:
import asyncio

locator_task = asyncio.create_task(locator.locate(query, tree))
r2r_task = asyncio.create_task(r2r_fallback.hybrid_search(query.text, doc_id))

locator_nodes, r2r_nodes = await asyncio.gather(locator_task, r2r_task)

# Merge with scoring:
node_scores = {}
for node in locator_nodes:
    node_scores[node.node_id] = node_scores.get(node.node_id, 0) + node.confidence
for node_id in r2r_nodes:
    node_scores[node_id] = node_scores.get(node_id, 0) + 0.5  # R2R baseline score

# Nodes found by BOTH systems get highest priority
final_nodes = sorted(node_scores.items(), key=lambda x: -x[1])[:max_nodes]
```

**Persistence**: R2R manages its own PostgreSQL + pgvector store

---

## Complete Integration: The Self-Evolving Query Pipeline

Here's the full augmented pipeline, step by step:

### Phase 0: Session Start (new)
```python
# 1. Load/create user memory
user_memory = UserMemoryManager(user_id)
user_context = user_memory.get_user_context(query_text)

# 2. Load query intelligence for this document  
query_intel = QueryIntelligence(doc_id)
hints = query_intel.get_retrieval_hints(query_text)

# 3. Get retrieval performance insights
perf_insights = await retrieval_feedback.get_performance_insights(query_type, doc_id)
```

### Phase 1: Smart Retrieval (augmented)
```python
# 1. RAPTOR pre-filter (replaces full index dump)  
raptor_candidates = raptor_index.query(query_text, top_k=30)

# 2. Boost with historically successful nodes
if hints["suggested_nodes"]:
    raptor_candidates = boost(raptor_candidates, hints["suggested_nodes"])

# 3. Compressed Locator (only pre-filtered candidates)
compressed_index = tree.to_index(node_ids=raptor_candidates)
located_nodes = locator.locate(query, tree, index=compressed_index, user_context=user_context)

# 4. R2R fallback (parallel)
r2r_nodes = await r2r_fallback.hybrid_search(query_text, doc_id)

# 5. Merge + rerank
final_nodes = merge_and_rerank(located_nodes, r2r_nodes, hints)

# 6. Read sections (existing)
sections = reader.read(final_nodes, tree)

# 7. Smart reflect decision (learned, not hardcoded)
if perf_insights.get("reflect_value_rate", 1.0) > 0.2:
    sections = reflector.reflect(query, sections, tree)
```

### Phase 2: Synthesis + Verification (augmented)
```python
# 1. Inject user preferences into synthesis prompt
user_prefs = user_context.get("profile", "")
answer = synthesizer.synthesize(query, sections, user_preferences=user_prefs)

# 2. Smart verify decision (learned)
if not hints.get("skip_verification"):
    verification = verifier.verify(answer, sections)
```

### Phase 3: Learn (new)
```python
# 1. Record to RAPTOR heat map
for citation in answer.citations:
    raptor_index.record_citation(citation.section_id, query_text)

# 2. Store in user memory
user_memory.record_interaction(query_text, answer.answer_text)

# 3. Learn retrieval patterns
query_intel.learn_from_query(query_record)

# 4. Record retrieval quality feedback
await retrieval_feedback.record_feedback(query_record)

# 5. Persist heat map
await raptor_index.save_heat_map(doc_id)
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER QUERY                                │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MEMORY RECALL PHASE                            │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  MemoryOS   │  │  SimpleMem   │  │    memU Insights       │  │
│  │  User       │  │  Query       │  │    Performance         │  │
│  │  Context    │  │  Intelligence│  │    Patterns            │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬───────────┘  │
│         │                │                        │              │
│         └────────────────┼────────────────────────┘              │
│                          │                                       │
│                   Memory Context Bundle                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   SMART RETRIEVAL PHASE                           │
│                                                                  │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │  RAPTOR   │   │   GOVINDA    │   │     R2R Hybrid          │  │
│  │  Multi-   │──►│   Locator    │   │     Search Fallback     │  │
│  │  Resol.   │   │  (compressed)│   │  (vector+FTS+KG)        │  │
│  │  Filter   │   └──────┬───────┘   └────────────┬────────────┘  │
│  └──────────┘           │                        │               │
│                         └────────┬───────────────┘               │
│                                  │                               │
│                         MERGE + RERANK                           │
│                      (multi-signal fusion)                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              SYNTHESIS + VERIFICATION PHASE                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────┐          │
│  │  Synthesizer (with user preference injection)      │          │
│  │  Verifier (smart skip based on learned patterns)   │          │
│  └────────────────────────────────────────────────────┘          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      LEARNING PHASE                              │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐  │
│  │  RAPTOR   │  │  MemoryOS    │  │ SimpleMem│  │   memU     │  │
│  │  Heat Map │  │  Store Q&A   │  │  Store   │  │  Retrieval │  │
│  │  Update   │  │  Pair        │  │  Pattern │  │  Feedback  │  │
│  └──────────┘  └──────────────┘  └──────────┘  └────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   ANSWER     │
                    │  (smarter    │
                    │   each time) │
                    └──────────────┘
```

---

## Implementation Priority & Phases

### Phase A: Foundation (Week 1-2) — Highest Impact
1. **RAPTOR Node Heat Map** (Loop 1)
   - Build RAPTOR overlay at ingestion time
   - Replace spray-and-pray with compressed Locator
   - Add citation tracking → heat map
   - **Expected impact**: 60-70% reduction in Locator tokens, faster + more accurate

2. **SimpleMem Query Intelligence** (Loop 3)
   - Replace in-memory cache with persistent SimpleMem store
   - Learn retrieval patterns from QueryRecord data
   - Smart reflection/verification skipping
   - **Expected impact**: 20-30% reduction in LLM calls for repeat query types

### Phase B: Personalization (Week 3-4) — User Experience
3. **MemoryOS User Memory** (Loop 2)
   - Per-user memory initialization
   - Conversation continuity (coreference resolution)
   - User preference injection into prompts
   - **Expected impact**: Dramatically better follow-up questions + personalized answers

### Phase C: Self-Improvement (Week 5-6) — Compounding Returns
4. **memU Retrieval Feedback** (Loop 4)
   - Post-query retrieval grading
   - Evolving performance insights
   - Dynamic pipeline parameter tuning
   - **Expected impact**: System improves measurably over time (track precision, latency, user ratings)

### Phase D: Safety Net (Week 7-8) — Robustness
5. **R2R Hybrid Fallback** (Loop 5)
   - R2R deployment alongside GOVINDA
   - Dual-ingest pipeline (tree + chunks)
   - Merged retrieval with confidence scoring
   - Knowledge graph entity resolution
   - **Expected impact**: Catches 15-25% of queries where LLM-only retrieval fails

---

## New MongoDB Collections

| Collection | Purpose | Size Estimate |
|------------|---------|---------------|
| `raptor_indexes` | RAPTOR tree overlays + heat maps per document | ~50KB per doc |
| `query_intelligence` | SimpleMem LanceDB metadata references | ~10KB per doc |
| `retrieval_feedback` | memU performance tracking | ~5KB per 100 queries |

**Note**: MemoryOS uses file-based storage (no MongoDB). SimpleMem uses LanceDB (file-based). memU uses SQLite. R2R uses its own PostgreSQL. Only the RAPTOR heat map needs MongoDB.

---

## New File Structure

```
govinda_v2/
├── memory/                          # NEW: Memory subsystem
│   ├── __init__.py
│   ├── user_memory.py              # Loop 2: MemoryOS integration
│   ├── query_intelligence.py       # Loop 3: SimpleMem integration  
│   ├── retrieval_feedback.py       # Loop 4: memU integration
│   └── memory_manager.py          # Facade coordinating all memory systems
│
├── retrieval/
│   ├── raptor_index.py            # NEW Loop 1: RAPTOR overlay + heat map
│   ├── r2r_fallback.py            # NEW Loop 5: R2R hybrid search
│   ├── smart_merger.py            # NEW: Multi-source result merger
│   ├── locator.py                 # MODIFIED: accepts compressed index + user context
│   ├── router.py                  # MODIFIED: orchestrates multi-source retrieval
│   └── ... (existing files)
│
├── agents/
│   ├── qa_engine.py               # MODIFIED: Phase 0 (recall) + Phase 3 (learn)
│   └── ... (existing files)
│
└── config/
    └── settings.py                # MODIFIED: new memory/learning config section
```

---

## Configuration Additions

```python
# In config/settings.py

class MemorySettings(BaseModel):
    """Self-evolving memory configuration."""
    
    # Loop 1: RAPTOR
    raptor_enabled: bool = True
    raptor_layers: int = 3
    raptor_cluster_dim: int = 10
    heat_decay_days: float = 30.0
    heat_citation_weight: float = 1.0
    
    # Loop 2: MemoryOS  
    user_memory_enabled: bool = True
    short_term_capacity: int = 10
    mid_term_capacity: int = 500
    profile_update_threshold: float = 5.0
    
    # Loop 3: SimpleMem
    query_intelligence_enabled: bool = True
    min_queries_before_hints: int = 5
    
    # Loop 4: memU
    retrieval_feedback_enabled: bool = True
    feedback_memory_types: list[str] = ["skill", "behavior", "knowledge"]
    
    # Loop 5: R2R
    r2r_fallback_enabled: bool = False  # Requires R2R deployment
    r2r_base_url: str = "http://localhost:7272"
    r2r_merge_weight: float = 0.5
```

---

## Metrics to Track Self-Evolution

The system should measure and expose these metrics to prove it's getting smarter:

| Metric | Source | What It Shows |
|--------|--------|---------------|
| **Retrieval Precision** | cited_nodes / located_nodes | % of retrieved content actually used |
| **Locator Token Savings** | compressed_index_tokens / full_index_tokens | RAPTOR compression effectiveness |
| **Cache Hit Rate** | SimpleMem hits / total queries | % of queries with useful history |
| **Reflection Value Rate** | reflection_added_citations / reflections_run | How often reflection helps |
| **Verification Skip Rate** | skipped_verifications / total queries | How much time saved by learning |
| **User Rating Trend** | avg(feedback_rating) over time | Are answers actually improving? |
| **Repeat Query Accuracy** | compare answers for similar queries over time | Consistency + improvement |
| **Heat Map Coverage** | nodes_with_heat / total_nodes | How much of the doc is "mapped" |
| **Avg Query Latency** | total_time_s trend over time | Getting faster via smart skipping |

---

## Summary: Before vs. After

| Aspect | Before (Current) | After (Self-Evolving) |
|--------|------------------|----------------------|
| **Retrieval** | Full tree index dump every query | RAPTOR pre-filter → compressed Locator + R2R fallback |
| **User awareness** | None — every query is anonymous | MemoryOS profile + preferences + conversation history |
| **Learning** | None — query #1000 = query #1 | SimpleMem patterns + memU feedback loops |
| **Cache** | In-memory, lost on restart | Persistent, semantic, cross-session |
| **Verification** | Always runs (20-40s overhead) | Smart skip when learned patterns indicate it's safe |
| **Reflection** | Always runs or hardcoded toggle | Dynamic decision based on learned value rate |
| **Conversation** | Stateless — no follow-ups | Coreference resolution via short-term memory |
| **Feedback** | Collected, never used | Drives retrieval improvement, pipeline tuning |
| **Token cost** | High (full index + reflection + verification) | 40-60% lower via compression + smart skipping |
| **Answer quality** | Static | Compounds over time — every query makes the next one better |
