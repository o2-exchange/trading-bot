# PostHog Analytics Dashboard Guide - O2 Trading Bot

This document provides comprehensive instructions for creating analytics dashboards in PostHog for the O2 Trading Bot application.

---

## Table of Contents
1. [Events Overview](#events-overview)
2. [User Properties](#user-properties)
3. [Dashboard 1: User Acquisition & Onboarding](#dashboard-1-user-acquisition--onboarding)
4. [Dashboard 2: Trading Activity & Performance](#dashboard-2-trading-activity--performance)
5. [Dashboard 3: Session Analytics](#dashboard-3-session-analytics)
6. [Dashboard 4: Revenue & Volume Metrics](#dashboard-4-revenue--volume-metrics)
7. [Dashboard 5: User Retention & Engagement](#dashboard-5-user-retention--engagement)
8. [Funnels to Create](#funnels-to-create)
9. [Cohorts to Create](#cohorts-to-create)
10. [Alerts to Set Up](#alerts-to-set-up)

---

## Events Overview

The O2 Trading Bot tracks **6 core events**:

| Event Name | Description | Key Properties |
|------------|-------------|----------------|
| `app_opened` | User opens the application | `viewport_width`, `viewport_height`, `referrer` |
| `wallet_connected` | User connects their wallet | `wallet_address`, `wallet_type`, `is_evm` |
| `message_signed` | User signs T&C message | `wallet_address`, `time_to_sign_ms` |
| `session_started` | Trading session begins | `session_id`, `market_pairs`, `strategy_count`, `is_resume` |
| `order_placed` | Individual order executed | `order_id`, `market_pair`, `side`, `order_type`, `price_usd`, `quantity`, `value_usd` |
| `session_ended` | Trading session ends | `session_id`, `duration_ms`, `trade_count`, `total_volume_usd`, `realized_pnl`, `end_reason` |

### Base Properties (All Events)
Every event includes:
- `timestamp` - Unix timestamp in milliseconds
- `session_duration_ms` - Time elapsed since app load

---

## User Properties

Users are identified by their `wallet_address` (lowercase). Available user properties:

| Property | Type | Description |
|----------|------|-------------|
| `wallet_address` | string | Lowercase wallet address (identifier) |
| `wallet_type` | string | Wallet provider (MetaMask, Rabby, Phantom, fuel, fuelet, bako-safe) |
| `is_evm` | boolean | True for EVM chains, false for Fuel |
| `first_seen` | ISO string | First wallet connection timestamp |
| `last_seen` | ISO string | Most recent activity timestamp |

---

## Dashboard 1: User Acquisition & Onboarding

**Purpose:** Track new user signups, wallet connections, and onboarding completion.

### Insight 1.1: Daily/Weekly New Users
- **Type:** Trend
- **Event:** `wallet_connected`
- **Aggregation:** Unique users (by `wallet_address`)
- **Breakdown:** By day/week
- **Filter:** None (all new connections)

### Insight 1.2: Wallet Type Distribution
- **Type:** Pie Chart / Bar Chart
- **Event:** `wallet_connected`
- **Aggregation:** Total count
- **Breakdown:** By `wallet_type`
- **Time range:** Last 30 days

### Insight 1.3: EVM vs Fuel Chain Users
- **Type:** Pie Chart
- **Event:** `wallet_connected`
- **Aggregation:** Unique users
- **Breakdown:** By `is_evm` (true = EVM, false = Fuel)

### Insight 1.4: Onboarding Funnel Completion Rate
- **Type:** Funnel
- **Steps:**
  1. `app_opened`
  2. `wallet_connected`
  3. `message_signed`
  4. `session_started`
- **Conversion window:** 1 day

### Insight 1.5: Time to Sign T&C
- **Type:** Distribution / Histogram
- **Event:** `message_signed`
- **Property:** `time_to_sign_ms`
- **Aggregation:** Average, Median, P90

### Insight 1.6: Referrer Sources
- **Type:** Table / Bar Chart
- **Event:** `app_opened`
- **Breakdown:** By `referrer`
- **Aggregation:** Unique users
- **Filter:** `referrer` is set (not null)

### Insight 1.7: Device/Viewport Analysis
- **Type:** Table
- **Event:** `app_opened`
- **Breakdown:** By `viewport_width` (bucket into ranges: mobile <768, tablet 768-1024, desktop >1024)
- **Aggregation:** Unique users

---

## Dashboard 2: Trading Activity & Performance

**Purpose:** Monitor trading behavior, order patterns, and market preferences.

### Insight 2.1: Daily Orders Placed
- **Type:** Trend
- **Event:** `order_placed`
- **Aggregation:** Total count
- **Breakdown:** By day

### Insight 2.2: Order Volume by Market Pair
- **Type:** Bar Chart
- **Event:** `order_placed`
- **Aggregation:** Sum of `value_usd`
- **Breakdown:** By `market_pair`
- **Time range:** Last 7 days / 30 days

### Insight 2.3: Buy vs Sell Distribution
- **Type:** Pie Chart
- **Event:** `order_placed`
- **Aggregation:** Total count
- **Breakdown:** By `side` (Buy/Sell)

### Insight 2.4: Order Type Distribution
- **Type:** Pie Chart
- **Event:** `order_placed`
- **Aggregation:** Total count
- **Breakdown:** By `order_type` (Market/Limit)

### Insight 2.5: Average Order Size
- **Type:** Number / Trend
- **Event:** `order_placed`
- **Aggregation:** Average of `value_usd`
- **Breakdown:** By day (for trend)

### Insight 2.6: Top Trading Pairs
- **Type:** Table (ranked)
- **Event:** `order_placed`
- **Columns:**
  - `market_pair`
  - Count of orders
  - Sum of `value_usd`
  - Unique traders (by `wallet_address`)
- **Sort:** By volume descending

### Insight 2.7: Price Distribution by Market
- **Type:** Box Plot / Distribution
- **Event:** `order_placed`
- **Property:** `price_usd`
- **Breakdown:** By `market_pair`

### Insight 2.8: Orders per User Distribution
- **Type:** Histogram
- **Event:** `order_placed`
- **Aggregation:** Count per unique `wallet_address`
- **Shows:** How many orders typical users place

---

## Dashboard 3: Session Analytics

**Purpose:** Understand trading session patterns, duration, and outcomes.

### Insight 3.1: Daily Active Sessions
- **Type:** Trend
- **Event:** `session_started`
- **Aggregation:** Total count
- **Breakdown:** By day

### Insight 3.2: New vs Resumed Sessions
- **Type:** Stacked Bar Chart
- **Event:** `session_started`
- **Aggregation:** Total count
- **Breakdown:** By `is_resume` (true/false)

### Insight 3.3: Average Strategies per Session
- **Type:** Number / Trend
- **Event:** `session_started`
- **Aggregation:** Average of `strategy_count`

### Insight 3.4: Session Duration Distribution
- **Type:** Histogram / Distribution
- **Event:** `session_ended`
- **Property:** `duration_ms`
- **Convert to:** Minutes or hours for readability
- **Buckets:** 0-5min, 5-15min, 15-30min, 30-60min, 1-4hr, 4hr+

### Insight 3.5: Session End Reasons
- **Type:** Pie Chart
- **Event:** `session_ended`
- **Aggregation:** Total count
- **Breakdown:** By `end_reason`
  - `user_stopped` - Normal exit
  - `error` - Technical issues
  - `loss_limit` - Hit loss limit

### Insight 3.6: Trades per Session
- **Type:** Histogram / Average
- **Event:** `session_ended`
- **Property:** `trade_count`
- **Aggregation:** Average, Median, Distribution

### Insight 3.7: Session P&L Distribution
- **Type:** Histogram
- **Event:** `session_ended`
- **Property:** `realized_pnl`
- **Buckets:** Loss (<$-100, -$100 to -$10, -$10 to $0), Profit ($0-$10, $10-$100, >$100)

### Insight 3.8: Win Rate (Sessions with Positive P&L)
- **Type:** Number / Trend
- **Event:** `session_ended`
- **Formula:** (Count where `realized_pnl` > 0) / Total sessions * 100

### Insight 3.9: Popular Market Pair Combinations
- **Type:** Table
- **Event:** `session_started`
- **Property:** `market_pairs` (array)
- **Aggregation:** Count occurrences of each combination

---

## Dashboard 4: Revenue & Volume Metrics

**Purpose:** Track platform volume, user trading value, and financial metrics.

### Insight 4.1: Total Platform Volume (USD)
- **Type:** Big Number + Trend
- **Event:** `order_placed`
- **Aggregation:** Sum of `value_usd`
- **Time comparison:** vs previous period

### Insight 4.2: Daily Volume Trend
- **Type:** Line Chart
- **Event:** `order_placed`
- **Aggregation:** Sum of `value_usd`
- **Breakdown:** By day
- **Add:** 7-day moving average line

### Insight 4.3: Volume by User Segment
- **Type:** Bar Chart
- **Event:** `order_placed`
- **Aggregation:** Sum of `value_usd`
- **Breakdown:** By user cohorts (see Cohorts section)
  - Whales (>$100k volume)
  - Active traders ($10k-$100k)
  - Casual traders (<$10k)

### Insight 4.4: Average Session Volume
- **Type:** Number / Trend
- **Event:** `session_ended`
- **Aggregation:** Average of `total_volume_usd`

### Insight 4.5: Cumulative P&L Across All Users
- **Type:** Line Chart (cumulative)
- **Event:** `session_ended`
- **Aggregation:** Sum of `realized_pnl`
- **Breakdown:** Cumulative over time

### Insight 4.6: Top Traders by Volume
- **Type:** Table
- **Event:** `order_placed`
- **Group by:** `wallet_address`
- **Columns:**
  - Wallet address (truncated)
  - Total volume (`value_usd` sum)
  - Order count
  - First seen
- **Sort:** By volume descending
- **Limit:** Top 50

### Insight 4.7: Volume by Chain (EVM vs Fuel)
- **Type:** Stacked Area Chart
- **Event:** `order_placed`
- **Aggregation:** Sum of `value_usd`
- **Breakdown:** By user property `is_evm`

---

## Dashboard 5: User Retention & Engagement

**Purpose:** Measure user stickiness, retention rates, and engagement patterns.

### Insight 5.1: Retention Cohort Analysis
- **Type:** Retention table
- **Starting event:** `wallet_connected`
- **Return event:** `session_started`
- **Cohort by:** Week of first `wallet_connected`
- **Periods:** Week 0, Week 1, Week 2, ... Week 8

### Insight 5.2: Daily/Weekly/Monthly Active Users
- **Type:** Trend (3 lines)
- **Event:** `session_started` or `order_placed`
- **Aggregation:** Unique users by `wallet_address`
- **Breakdown:** DAU (daily), WAU (weekly), MAU (monthly)

### Insight 5.3: Stickiness (DAU/MAU Ratio)
- **Type:** Number / Trend
- **Formula:** DAU / MAU * 100
- **Target:** >20% is good for trading apps

### Insight 5.4: User Lifecycle Stages
- **Type:** Funnel / Table
- **Cohorts:**
  - New (first session this week)
  - Returning (had session in past, returned)
  - Power users (5+ sessions in 30 days)
  - Dormant (no activity in 14+ days)

### Insight 5.5: Sessions per User (Last 30 Days)
- **Type:** Histogram
- **Event:** `session_started`
- **Aggregation:** Count per unique user
- **Time range:** Last 30 days

### Insight 5.6: Time Between Sessions
- **Type:** Distribution
- **Calculation:** Time between consecutive `session_started` events per user
- **Median, Average, P90**

### Insight 5.7: Feature Adoption - Strategy Usage
- **Type:** Histogram
- **Event:** `session_started`
- **Property:** `strategy_count`
- **Aggregation:** Distribution of strategy counts

### Insight 5.8: User Activity Heatmap
- **Type:** Heatmap
- **Event:** `session_started`
- **X-axis:** Hour of day
- **Y-axis:** Day of week
- **Value:** Count of sessions

---

## Funnels to Create

### Funnel 1: Complete Onboarding Funnel
```
Steps:
1. app_opened
2. wallet_connected
3. message_signed
4. session_started
5. order_placed

Conversion window: 7 days
Breakdown by: wallet_type
```

### Funnel 2: Wallet to First Trade
```
Steps:
1. wallet_connected
2. session_started
3. order_placed

Conversion window: 24 hours
Breakdown by: is_evm
```

### Funnel 3: Session Completion
```
Steps:
1. session_started
2. order_placed (at least 1)
3. session_ended (with end_reason = 'user_stopped')

Conversion window: 1 day
```

### Funnel 4: Repeat Trading
```
Steps:
1. session_ended (first session)
2. session_started (second session)

Conversion window: 7 days
Shows: What % of users return for a second session
```

---

## Cohorts to Create

### Cohort 1: Whale Traders
```
Criteria: Users who have placed orders with total value_usd > $100,000 in lifetime
Event: order_placed
Aggregation: Sum of value_usd > 100000
```

### Cohort 2: Active Traders
```
Criteria: Users with 5+ sessions in last 30 days
Event: session_started
Count: >= 5
Time range: Last 30 days
```

### Cohort 3: New Users (This Week)
```
Criteria: First wallet_connected event within last 7 days
Event: wallet_connected
First time: Last 7 days
```

### Cohort 4: Dormant Users
```
Criteria: Connected wallet 14+ days ago, no session_started in last 14 days
Complex:
- wallet_connected occurred > 14 days ago
- session_started did NOT occur in last 14 days
```

### Cohort 5: EVM Users
```
Criteria: is_evm = true
User property: is_evm equals true
```

### Cohort 6: Fuel Native Users
```
Criteria: is_evm = false
User property: is_evm equals false
```

### Cohort 7: Multi-Strategy Users
```
Criteria: Users who have started sessions with strategy_count >= 3
Event: session_started
Property: strategy_count >= 3
```

### Cohort 8: Profitable Traders
```
Criteria: Users whose total realized_pnl > 0
Event: session_ended
Aggregation: Sum of realized_pnl > 0
```

### Cohort 9: High-Frequency Traders
```
Criteria: Users with 50+ orders in last 7 days
Event: order_placed
Count: >= 50
Time range: Last 7 days
```

---

## Alerts to Set Up

### Alert 1: Sudden Drop in Daily Active Users
```
Metric: Unique users with session_started
Condition: Drops > 30% compared to 7-day average
Frequency: Daily
Channel: Slack/Email
```

### Alert 2: High Error Rate in Session Endings
```
Metric: % of session_ended with end_reason = 'error'
Condition: > 10% of sessions end in error
Frequency: Hourly
```

### Alert 3: Volume Spike/Drop
```
Metric: Sum of order_placed.value_usd
Condition: Changes > 50% from previous day
Frequency: Daily
```

### Alert 4: New User Spike
```
Metric: Count of wallet_connected (unique)
Condition: > 2x daily average
Frequency: Daily
Note: Could indicate viral growth or bot activity
```

### Alert 5: Loss Limit Triggers
```
Metric: Count of session_ended where end_reason = 'loss_limit'
Condition: > 20 in 1 hour
Frequency: Hourly
Note: May indicate market volatility affecting users
```

---

## SQL Queries for Advanced Analysis

### Query 1: User Lifetime Value (LTV) by Cohort
```sql
SELECT
  DATE_TRUNC('week', first_seen) as cohort_week,
  COUNT(DISTINCT wallet_address) as users,
  SUM(total_volume_usd) as total_volume,
  AVG(total_volume_usd) as avg_volume_per_user
FROM (
  SELECT
    properties.wallet_address,
    MIN(timestamp) as first_seen,
    SUM(properties.value_usd) as total_volume_usd
  FROM events
  WHERE event = 'order_placed'
  GROUP BY properties.wallet_address
)
GROUP BY cohort_week
ORDER BY cohort_week
```

### Query 2: Session Performance Metrics
```sql
SELECT
  DATE_TRUNC('day', timestamp) as day,
  COUNT(*) as total_sessions,
  AVG(properties.duration_ms / 60000) as avg_duration_minutes,
  AVG(properties.trade_count) as avg_trades,
  AVG(properties.total_volume_usd) as avg_volume,
  SUM(CASE WHEN properties.realized_pnl > 0 THEN 1 ELSE 0 END)::float / COUNT(*) as win_rate
FROM events
WHERE event = 'session_ended'
GROUP BY day
ORDER BY day DESC
```

### Query 3: Wallet Retention by Type
```sql
WITH first_session AS (
  SELECT
    properties.wallet_address,
    person.properties.wallet_type,
    MIN(timestamp) as first_session_time
  FROM events
  WHERE event = 'session_started'
  GROUP BY 1, 2
),
return_sessions AS (
  SELECT
    properties.wallet_address,
    COUNT(*) as session_count
  FROM events
  WHERE event = 'session_started'
  GROUP BY 1
)
SELECT
  wallet_type,
  COUNT(*) as total_users,
  AVG(session_count) as avg_sessions_per_user,
  SUM(CASE WHEN session_count > 1 THEN 1 ELSE 0 END)::float / COUNT(*) as return_rate
FROM first_session f
JOIN return_sessions r ON f.wallet_address = r.wallet_address
GROUP BY wallet_type
```

---

## Dashboard Organization

### Recommended Dashboard Structure

1. **Executive Overview** (C-level summary)
   - Total Users, Total Volume, Active Sessions (big numbers)
   - Volume trend (7-day)
   - New users trend
   - Key conversion rate (wallet → first trade)

2. **User Acquisition** (Growth team)
   - New user trends
   - Referrer analysis
   - Wallet type breakdown
   - Onboarding funnel

3. **Trading Analytics** (Product team)
   - Order metrics
   - Market pair analysis
   - Session performance
   - P&L distribution

4. **Retention & Engagement** (Product/Growth)
   - Retention cohorts
   - DAU/WAU/MAU
   - Stickiness metrics
   - User lifecycle

5. **Technical Health** (Engineering)
   - Error rates (session_ended with error)
   - Load patterns (activity heatmap)
   - Session duration anomalies

---

## Event Properties Quick Reference

### `app_opened`
```json
{
  "timestamp": 1704067200000,
  "session_duration_ms": 0,
  "viewport_width": 1920,
  "viewport_height": 1080,
  "referrer": "https://google.com"
}
```

### `wallet_connected`
```json
{
  "timestamp": 1704067210000,
  "session_duration_ms": 10000,
  "wallet_address": "0x1234...abcd",
  "wallet_type": "MetaMask",
  "is_evm": true
}
```

### `message_signed`
```json
{
  "timestamp": 1704067230000,
  "session_duration_ms": 30000,
  "wallet_address": "0x1234...abcd",
  "time_to_sign_ms": 15000
}
```

### `session_started`
```json
{
  "timestamp": 1704067300000,
  "session_duration_ms": 100000,
  "wallet_address": "0x1234...abcd",
  "session_id": "sess_abc123",
  "market_pairs": ["ETH/USDC", "BTC/USDC"],
  "strategy_count": 2,
  "is_resume": false
}
```

### `order_placed`
```json
{
  "timestamp": 1704067400000,
  "session_duration_ms": 200000,
  "wallet_address": "0x1234...abcd",
  "session_id": "sess_abc123",
  "order_id": "ord_xyz789",
  "market_pair": "ETH/USDC",
  "side": "Buy",
  "order_type": "Limit",
  "price_usd": 2500.50,
  "quantity": 0.5,
  "value_usd": 1250.25
}
```

### `session_ended`
```json
{
  "timestamp": 1704071000000,
  "session_duration_ms": 3800000,
  "wallet_address": "0x1234...abcd",
  "session_id": "sess_abc123",
  "duration_ms": 3700000,
  "trade_count": 15,
  "total_volume_usd": 25000.00,
  "realized_pnl": 150.75,
  "end_reason": "user_stopped"
}
```

---

## Notes for Implementation

1. **User Identification**: Users are identified by lowercase `wallet_address`. All analytics tied to wallet addresses.

2. **Session Tracking**: Each trading session has a unique `session_id` that links `session_started`, `order_placed`, and `session_ended` events.

3. **Time Properties**:
   - `timestamp` is Unix milliseconds
   - `duration_ms` and `time_to_sign_ms` are in milliseconds (divide by 1000 for seconds, 60000 for minutes)

4. **Currency**: All monetary values (`value_usd`, `price_usd`, `total_volume_usd`, `realized_pnl`) are in USD.

5. **Chain Identification**: `is_evm` boolean distinguishes EVM chains (Ethereum, etc.) from Fuel blockchain users.

6. **Wallet Types**: Common values for `wallet_type`:
   - EVM: `MetaMask`, `Rabby`, `Phantom`, `WalletConnect`
   - Fuel: `fuel`, `fuelet`, `bako-safe`
