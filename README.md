# travelog-ai

You come home from a trip. Your memories are scattered across your camera roll, notes app, and maps. This is a private, self-hosted AI travel journal that runs on Cloudflare Workers. You own all your data.

**Live Demo:** [travelog-ai.casey-digennaro.workers.dev](https://travelog-ai.casey-digennaro.workers.dev)

## What It Does

Travelog-ai is a single-page web app you host yourself. It provides a central place to log past trips, plan future ones, and save places you've visited. You can ask it questions about your travels in natural language.

## Features

*   **Streaming AI Chat:** Ask "what was that wine bar in Lisbon?" and get an answer based on your own saved journals and places.
*   **Automatic Entry Tagging:** Entries you write are automatically tagged with the local weather, time, and location at the moment of posting.
*   **Personal Place Library:** Save restaurants, hikes, or museums with your own notes and ratings.
*   **Trip Timeline:** View your past and upcoming travels in a single chronological scroll.
*   **One-Click GeoJSON Export:** Download all your saved locations to use in other mapping tools.

## How It Works

You fork this repository and deploy it once to your own Cloudflare account. The application is a single, self-contained Cloudflare Worker with no runtime dependencies. It uses:
*   Cloudflare Workers for hosting and API logic.
*   Cloudflare KV for private, persistent storage.
*   A third-party LLM API (DeepSeek) to power the chat feature. Your data is only sent to the LLM when you actively ask a question.

## One Honest Limitation

Automatic location and weather tagging for journal entries requires your browser to provide accurate GPS data at the time of writing. If location services are off or inaccurate, you will need to tag entries manually.

## Quick Start

1.  **Fork** this repository to your GitHub account.
2.  Clone your fork locally and run `npm run deploy`. Follow the Cloudflare Wrangler setup prompts.
3.  Set your `DEEPSEEK_API_KEY` as a secret in your Cloudflare Worker.
4.  Your instance is live. You can modify the frontend in `/public` or the agent logic in `/src` at any time.

Open source, MIT license.

Attribution: Superinstance and Lucineer (DiGennaro et al.)

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>