#!/usr/bin/env python3
import os
import json
from git import Repo

# Since you're running inside the repository, use the current directory.
LOCAL_DIR = "."
JSON_FILENAME = "beer.json"
OUTPUT_FILE = "beer_versions.jsonl"

repo = Repo(LOCAL_DIR)

# Get all commits that affected the JSON file
commits = list(repo.iter_commits(paths=JSON_FILENAME))
print(f"Found {len(commits)} commits affecting {JSON_FILENAME}")

# Open the output file (JSON Lines format)
with open(OUTPUT_FILE, "w") as outfile:
    for commit in commits:
        commit_hash = commit.hexsha
        timestamp = commit.committed_datetime.isoformat()
        
        try:
            # Retrieve the version of the file from this commit
            file_blob = commit.tree / JSON_FILENAME
            file_contents = file_blob.data_stream.read().decode("utf-8")
            data = json.loads(file_contents)
        except Exception as e:
            print(f"Skipping commit {commit_hash} due to error: {e}")
            continue
        
        # Prepare the record with commit metadata and file data
        record = {
            "commit": commit_hash,
            "timestamp": timestamp,
            "data": data
        }
        
        # Write the record as a single JSON line
        outfile.write(json.dumps(record) + "\n")

print(f"All versions extracted into {OUTPUT_FILE}")
