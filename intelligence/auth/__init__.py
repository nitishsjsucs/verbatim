"""
Intelligence System Authentication & Authorization.

This is a self-contained auth module for the multi-tenant intelligence system.
It does NOT share auth with the main compliance platform (better-auth).
It is a separate pocket system with its own:
  - User store (MongoDB collection: intel_accounts)
  - JWT token generation and verification
  - Password hashing (bcrypt via hashlib/hmac fallback)
  - Role enforcement middleware
"""
