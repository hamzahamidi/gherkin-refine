# Performance

`npm run bench` creates representative three-step Feature files, then measures `lintFiles` at 1, 100, and 1,000 files with concurrency 8. It reports elapsed time, diagnostic count, and sampled peak resident memory.

One local run on Node.js 26.5.1 produced:

| Files | Elapsed time | Peak resident memory | Diagnostics |
| ---: | ---: | ---: | ---: |
| 1 | 6.7 ms | 66.7 MiB | 0 |
| 100 | 16.3 ms | 70 MiB | 0 |
| 1,000 | 102 ms | 85.1 MiB | 0 |

These are single-run measurements from one machine, not performance guarantees. The first measurement is the first lint call in the process. Later measurements reuse the loaded runtime. The project has no result cache, so each call reads and parses its files. Peak memory is sampled every 5 ms.
