# Project activity aggregate

`POST /query/activity` authenticates with a Bearer read key. The server resolves the project from that key; request project IDs and additional fields are rejected. One project must represent one authorized surface and tenant. This endpoint does not enforce a tenant property inside a shared project.

Request: `{ "range": { "from": 1000, "to": 2000 }, "recentFrom": 1500, "pageViewEvent": "page_view" }`. All times are epoch milliseconds. The half-open event-time window must be positive, at most 31 days, with `recentFrom` inside it. The upper boundary allows at most 60 seconds of future clock tolerance. `pageViewEvent` defaults to `page_view` and has a 128-character limit.

Response: `{ "projectId": "resolved-project", "summary": { "identifiedUsers": 0, "recentIdentifiedUsers": 0, "pageViews": 0, "anonymousVisitors": 0, "anonymousVisits": 0, "lastEventAt": null, "lastReceivedAt": null, "onlineUsers": null } }`.

Identified users are distinct nonempty user IDs across all events in the window. Recent identified users use the same event clock starting at `recentFrom`. Page views count only the configured event. Anonymous visitors count nonempty device IDs on anonymous page events. Anonymous visits count distinct device/session tuples on those events with positive session IDs. If any anonymous page event lacks a valid device/session tuple, visits are null because coverage is incomplete. SDK sessions can span multiple page views and are not evidence of presence.

Last event and receive signals cover project events before `to`, including older events outside the requested window. Both are null without observed events. A last receive timestamp can be newer than event time because of offline upload or backfill. Online users remain null: no heartbeat is available. This response exposes no identities, event payloads, or properties. An empty result is zero observed activity, not proof that collection is installed or healthy; the integrating service must show independently configured coverage and failures.

Trade-offs: one exact ClickHouse aggregate scans project history before the upper boundary to preserve last-signal evidence. Exact distinct sets cost memory for large projects; the 31-day counting window bounds the counting workload but not the historical signal scan. Projects are the authorization boundary; shared multi-tenant projects require a separately reviewed scoped contract. No collection, consent, identity stitching, retention policy, or deployment is changed by this read endpoint.
