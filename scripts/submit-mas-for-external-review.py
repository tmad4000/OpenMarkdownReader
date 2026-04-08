#!/usr/bin/env python3
"""
Submit the most-recently-uploaded MAS build for external TestFlight review.

Run this AFTER `scripts/build-mas.sh --upload` finishes. That script uploads
and clears compliance, but does NOT submit for beta review. This script:

1. Finds the most recent VALID build for the app
2. Ensures it's assigned to the 'friendsext' external beta group
3. Creates a betaAppReviewSubmission to trigger Apple's external review
4. Reports the submission state

Usage: python3 scripts/submit-mas-for-external-review.py
"""

import jwt, time, json, sys, urllib.request, urllib.error

APP_ID = '6758376669'  # OpenMarkdownReader
EXTERNAL_GROUP_NAME = 'friendsext'
KEY_PATH = '/Users/jacobcole/.private_keys/AuthKey_KWJX4896S5.p8'
KEY_ID = 'KWJX4896S5'
ISSUER_ID = '69a6de95-2833-47e3-e053-5b8c7c11a4d1'
API_BASE = 'https://api.appstoreconnect.apple.com'

def get_token():
    with open(KEY_PATH) as f:
        key = f.read()
    now = int(time.time())
    return jwt.encode(
        {'iss': ISSUER_ID, 'iat': now, 'exp': now + 1200, 'aud': 'appstoreconnect-v1'},
        key, algorithm='ES256', headers={'kid': KEY_ID}
    )

def api(method, path, body=None, token=None):
    if token is None:
        token = get_token()
    headers = {'Authorization': f'Bearer {token}'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(f'{API_BASE}{path}', data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read()
        # Some endpoints (POST/PATCH on relationships, 204 No Content) return empty bodies
        if not raw:
            return {}
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"HTTP {e.code} on {method} {path}")
        print(f"Response: {body_text}", file=sys.stderr)
        raise

def main():
    token = get_token()
    print("=== Finding most recent VALID build ===")
    # Sort by upload date descending, get the latest
    data = api('GET', f'/v1/builds?filter[app]={APP_ID}&sort=-uploadedDate&limit=5', token=token)
    latest = None
    for b in data.get('data', []):
        a = b['attributes']
        print(f"  Build {a.get('version')} — {a.get('processingState')} — uploaded {a.get('uploadedDate')}")
        if latest is None:
            latest = b
    if not latest:
        print("ERROR: No builds found", file=sys.stderr)
        sys.exit(1)
    build_id = latest['id']
    build_version = latest['attributes']['version']
    state = latest['attributes']['processingState']
    print(f"\nSelected build: {build_version} (id={build_id}), state={state}")

    if state != 'VALID':
        print(f"Build is not VALID yet (state={state}). Wait for processing to complete.", file=sys.stderr)
        sys.exit(1)

    # Check if already submitted
    print("\n=== Checking for existing review submission ===")
    existing = api('GET', f'/v1/betaAppReviewSubmissions?filter[build]={build_id}', token=token)
    if existing.get('data'):
        for sub in existing['data']:
            print(f"  Existing submission: state={sub['attributes'].get('betaReviewState')}")
        if any(s['attributes'].get('betaReviewState') in ('WAITING_FOR_REVIEW', 'IN_REVIEW', 'APPROVED')
               for s in existing['data']):
            print("Build is already submitted. Nothing to do.")
            return

    # Ensure the build is in the friendsext external group
    print(f"\n=== Finding external group '{EXTERNAL_GROUP_NAME}' ===")
    groups = api('GET', f'/v1/betaGroups?filter[app]={APP_ID}', token=token)
    target_group = None
    for g in groups.get('data', []):
        if g['attributes'].get('name') == EXTERNAL_GROUP_NAME:
            target_group = g
            break
    if not target_group:
        print(f"ERROR: Group '{EXTERNAL_GROUP_NAME}' not found", file=sys.stderr)
        sys.exit(1)
    group_id = target_group['id']
    print(f"  Group id: {group_id}")

    print(f"\n=== Adding build to group '{EXTERNAL_GROUP_NAME}' ===")
    try:
        api('POST', f'/v1/betaGroups/{group_id}/relationships/builds',
            body={'data': [{'type': 'builds', 'id': build_id}]}, token=token)
        print("  Build added to group")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print("  Build already in group (409 conflict — OK)")
        else:
            raise

    print(f"\n=== Submitting build for beta review ===")
    try:
        result = api('POST', '/v1/betaAppReviewSubmissions',
                     body={
                         'data': {
                             'type': 'betaAppReviewSubmissions',
                             'relationships': {
                                 'build': {'data': {'type': 'builds', 'id': build_id}}
                             }
                         }
                     }, token=token)
        sub_state = result['data']['attributes'].get('betaReviewState')
        sub_id = result['data']['id']
        print(f"  ✓ Submission created!")
        print(f"  Submission id: {sub_id}")
        print(f"  State: {sub_state}")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print("  Build already submitted for review (409 conflict)")
        else:
            raise

    print("\n=== Done ===")
    print("Apple's beta review usually completes in 24-48 hours.")
    print(f"Monitor status at: https://appstoreconnect.apple.com/apps/{APP_ID}/testflight/ios")

if __name__ == '__main__':
    main()
