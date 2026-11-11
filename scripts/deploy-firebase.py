#!/usr/bin/env python3
"""
Direct Firebase Hosting & Realtime Database Deployment Script.
Uses a Firebase Service Account JSON (via GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT)
to deploy `dist/` to Firebase Hosting and `database.rules.json` to Firebase Realtime Database,
without requiring `serviceusage.services.get` IAM permissions.
"""

import gzip
import hashlib
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from google.oauth2 import service_account
from google.auth.transport.requests import Request

PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "weblorant")
SITE_ID = os.environ.get("FIREBASE_SITE_ID", "weblorant")
RTDB_URL = os.environ.get(
    "FIREBASE_DATABASE_URL",
    "https://weblorant-default-rtdb.europe-west1.firebasedatabase.app",
)

SCOPES = [
    "https://www.googleapis.com/auth/firebase",
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
]


def get_access_token() -> str:
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if sa_json:
        info = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    elif sa_path and os.path.isfile(sa_path):
        creds = service_account.Credentials.from_service_account_file(sa_path, scopes=SCOPES)
    else:
        raise RuntimeError(
            "Neither FIREBASE_SERVICE_ACCOUNT nor GOOGLE_APPLICATION_CREDENTIALS is set."
        )
    creds.refresh(Request())
    return creds.token


def api_request(method: str, url: str, token: str, data: bytes | dict | None = None, content_type: str = "application/json") -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    body = None
    if isinstance(data, dict):
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = content_type
    elif isinstance(data, bytes):
        body = data
        headers["Content-Type"] = content_type

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body}") from e


def deploy_database_rules(token: str, rules_file: Path) -> None:
    if not rules_file.is_file():
        print(f"[Database] Skipping: {rules_file} not found.")
        return
    print(f"[Database] Deploying rules from {rules_file} to {RTDB_URL} ...")
    raw_rules = rules_file.read_bytes()
    url = f"{RTDB_URL.rstrip('/')}/.settings/rules.json"
    api_request("PUT", url, token, data=raw_rules, content_type="application/json")
    print("[Database] Rules deployed successfully!")


def deploy_hosting(token: str, dist_dir: Path, firebase_json_path: Path) -> None:
    if not dist_dir.is_dir():
        raise RuntimeError(f"Build directory '{dist_dir}' does not exist. Run 'npm run build' first.")

    print(f"[Hosting] Collecting files from {dist_dir} ...")
    files_map: dict[str, str] = {}        # "/path" -> sha256_of_gzipped
    gzipped_blobs: dict[str, bytes] = {} # sha256 -> gzipped_bytes

    for root, _, filenames in os.walk(dist_dir):
        for fname in filenames:
            full_path = Path(root) / fname
            rel_path = "/" + full_path.relative_to(dist_dir).as_posix()
            raw_bytes = full_path.read_bytes()
            gz_bytes = gzip.compress(raw_bytes, mtime=0)
            sha256_hash = hashlib.sha256(gz_bytes).hexdigest()
            files_map[rel_path] = sha256_hash
            gzipped_blobs[sha256_hash] = gz_bytes

    print(f"[Hosting] Found {len(files_map)} files.")

    # Parse hosting config from firebase.json
    hosting_config = {
        "rewrites": [{"glob": "**", "path": "/index.html"}],
        "headers": [
            {
                "glob": "/assets/**",
                "headers": {"Cache-Control": "public, max-age=31536000, immutable"},
            }
        ],
    }

    base_api = f"https://firebasehosting.googleapis.com/v1beta1/sites/{SITE_ID}"

    # 1. Create new version
    print("[Hosting] Creating new Hosting version ...")
    version_resp = api_request("POST", f"{base_api}/versions", token, {"config": hosting_config})
    version_name = version_resp["name"]  # e.g. sites/weblorant/versions/xxx
    print(f"[Hosting] Created version: {version_name}")

    # 2. Populate files
    pop_resp = api_request(
        "POST",
        f"https://firebasehosting.googleapis.com/v1beta1/{version_name}:populateFiles",
        token,
        {"files": files_map},
    )
    upload_required = pop_resp.get("uploadRequiredHashes", [])
    upload_url = pop_resp.get("uploadUrl", "")
    print(f"[Hosting] Files requiring upload: {len(upload_required)} / {len(files_map)}")

    # 3. Upload missing files
    for idx, h in enumerate(upload_required, 1):
        blob = gzipped_blobs[h]
        target_url = f"{upload_url}/{h}"
        print(f"  [{idx}/{len(upload_required)}] Uploading {h[:12]}... ({len(blob)} bytes)")
        api_request("POST", target_url, token, data=blob, content_type="application/octet-stream")

    # 4. Finalize version
    print("[Hosting] Finalizing version ...")
    api_request(
        "PATCH",
        f"https://firebasehosting.googleapis.com/v1beta1/{version_name}?updateMask=status",
        token,
        {"status": "FINALIZED"},
    )

    # 5. Create release
    print("[Hosting] Releasing version to live channel ...")
    release_resp = api_request(
        "POST",
        f"{base_api}/releases?versionName={version_name}",
        token,
        {"message": "Automated deployment via deploy-firebase.py"},
    )
    print(f"[Hosting] Release complete! Live at: https://{SITE_ID}.web.app")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    token = get_access_token()
    deploy_database_rules(token, repo_root / "database.rules.json")
    deploy_hosting(token, repo_root / "dist", repo_root / "firebase.json")
    print("\n=== All Firebase deployments succeeded! ===")


if __name__ == "__main__":
    main()
