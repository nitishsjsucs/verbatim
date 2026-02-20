import logging
import os
from typing import Optional
from pymongo import MongoClient
import gridfs
from config.settings import get_settings

logger = logging.getLogger(__name__)

class MongoManager:
    _instance = None
    _client: Optional[MongoClient] = None
    _db = None
    _fs = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MongoManager, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        settings = get_settings()
        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        db_name = os.getenv("MONGO_DB_NAME", "govinda_v2")

        try:
            # Atlas (mongodb+srv) requires server_api for stable API
            if mongo_uri.startswith("mongodb+srv"):
                from pymongo.server_api import ServerApi
                self._client = MongoClient(
                    mongo_uri,
                    server_api=ServerApi("1"),
                    tls=True,
                    tlsAllowInvalidCertificates=False,
                )
            else:
                self._client = MongoClient(mongo_uri)

            self._db = self._client[db_name]
            self._fs = gridfs.GridFS(self._db)
            self._client.admin.command("ping")
            logger.info(f"Connected to MongoDB: {db_name}")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise e

    @property
    def db(self):
        return self._db

    @property
    def fs(self):
        return self._fs

    def get_collection(self, name: str):
        return self._db[name]

# Global helper to access db
def get_db():
    return MongoManager().db

def get_fs():
    return MongoManager().fs
