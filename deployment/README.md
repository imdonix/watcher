# Watcher deployment

Private-registry image push + Helm chart for k3s (Traefik).

## Images

Dockerfiles live under `docker/` (monorepo root build context).

| Image | Dockerfile |
|-------|------------|
| `watcher-api` | `docker/api.Dockerfile` |
| `watcher-scraper` | `docker/scraper.Dockerfile` |
| `watcher-web` | `docker/web.Dockerfile` |

Each image runs `docker/link-workspace-modules.sh` so every workspace package’s `node_modules` points at the root install (Bun resolves deps next to each package).

Build & push (from repo root):

```bash
./deployment/_push.sh              # tag latest
./deployment/_push.sh 1.0.0
REGISTRY=192.168.0.100:32500 ./deployment/_push.sh $(git rev-parse --short HEAD)
```

## Helm

Chart: `deployment/watcher`  
Public host: **watcher.donix.dev** (Traefik ingress)

```bash
# first install
helm upgrade --install watcher ./deployment/watcher \
  -n watcher --create-namespace \
  -f ./deployment/live-values.yaml

# after a new push
helm upgrade watcher ./deployment/watcher \
  -n watcher \
  -f ./deployment/live-values.yaml \
  --set images.tag=<tag>
```

### Routing

| Path | Service |
|------|---------|
| `/api`, `/health` | API |
| `/` | Web SPA |

### Secrets

Default chart creates Secret `watcher` when `secret.create: true` (keys: `postgres-password`, `database-url`, `api-token`, VAPID keys).  
Set `secret.create: false` and supply an existing secret with the same keys if you manage secrets yourself.

### Notes

- Scraper is ClusterIP only (no Ingress); API talks to it in-cluster.
- Scraper mounts `emptyDir` Memory on `/dev/shm` for Chromium.
- TLS secret `watcher-tls` is expected to already exist (cert-manager / Traefik).
