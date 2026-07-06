# Queue runner MVP

This adds a temporary authenticated runner for queued photo jobs.

It does not call an AI provider.

Current transition check:

```text
job queued -> running -> succeeded
photo queued -> processing -> processed
session processing -> review
```

The runner processes up to 3 queued photo jobs per call.

The next step is replacing this temporary runner with a protected background worker and real OCR provider adapter.
