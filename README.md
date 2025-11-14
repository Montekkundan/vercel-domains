### Domain search demo

This example is a minimal Next.js app that hits a serverless route to perform Vercel domain availability checks. Multi-word queries are routed through the Vercel AI SDK (Gateway + `generateText`) to craft brandable labels before bulk availability is requested with `@vercel/sdk`. The UI (app router + client components) debounces input, shows optimistic skeleton states, and opens results directly in the Vercel Domains search page.
