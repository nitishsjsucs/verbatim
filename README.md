# Govinda V2

A modern, vectorless RAG system for analyzing complex documents (PDFs) using a hierarchical tree structure and LLM reasoning.

## Features
- **Tree-based RAG**: Preserves document structure (Chapters, Sections) for context-aware retrieval.
- **Linear-style UI**: Clean, responsive interface built with Next.js and Shadcn UI.
- **Deep PDF Integration**: Side-by-side view with raw PDF serving and deep linking.
- **Portable Backend**: FastAPI service ready for deployment on platforms like Render.

## Project Structure
- `/web`: Next.js Frontend
- `/app_backend`: FastAPI Backend
- `/ingestion`: Document processing pipeline (PDF -> Tree)
- `/retrieval`: RAG logic (Locator -> Reader -> Synthesizer)
- `/tree`: JSON-based tree storage

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- OpenAI API Key (GPT-4o / GPT-4-Turbo recommended)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone <your-repo-url>
    cd govinda-v2
    ```

2.  **Backend Setup**:
    ```bash
    # Create virtual env
    python -m venv venv
    source venv/bin/activate  # or venv\Scripts\activate on Windows
    
    # Install dependencies
    pip install -r requirements.txt
    ```

3.  **Frontend Setup**:
    ```bash
    cd web
    npm install
    ```

4.  **Environment Variables**:
    Create a `.env` file in the root:
    ```
    OPENAI_API_KEY=sk-your-key-here
    ```

## Running Locally

1.  **Start Backend**:
    ```bash
    # From project root
    uvicorn app_backend.main:app --reload --port 8000
    ```

2.  **Start Frontend**:
    ```bash
    # From /web directory
    npm run dev
    ```

## Deployment

### Render (Backend)
This repository is configured for Render deployment:
1.  Connect your GitHub repo to Render.
2.  Select **Blueprints** and use `render.yaml`.
3.  This will create:
    -   A **Web Service** building with `pip install -r requirements.txt`.
    -   A **Persistent Disk** mounted at `/data` to store your documents.

### Vercel (Frontend)
1.  Deploy the `/web` directory to Vercel.
2.  Set `NEXT_PUBLIC_API_URL` environment variable to your Render backend URL.
