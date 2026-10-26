# Watcher deployment

Docker Hub images + Helm chart for k3s (Traefik).

## Images

Dockerfiles live under `docker/` (monorepo root build context). CI publishes them to Docker Hub
on every push to `main`, on `v*.*.*` tags, and on manual workflow dispatch:

| Image | Docker Hub | Dockerfile |
|-------|------------|------------|
| `watcher-api` | `docker.io/imdonix/watcher-api` | `docker/api.Dockerfile` |
| `watcher-scraper` | `docker.io/imdonix/watcher-scraper` | `docker/scraper.Dockerfile` |
| `watcher-web` | `docker.io/imdonix/watcher-web` | `docker/web.Dockerfile` |

Tags: `latest` (main / version tags), branch name, `sha-<short>`, and SemVer on `vX.Y.Z` tags.
See `.github/workflows/docker-publish.yml` and the "Publishing images" section in the root README.

Images use a multi-stage “manifests only” install (`bun install --filter … --linker=hoisted`) so dependency layers stay cached without listing every `package.json` by hand, and only the target app’s workspace graph is installed.

For a local manual push (CI is the normal path):

```bash
docker login
./deployment/_push.sh              # tag latest
./deployment/_push.sh 1.0.0
TAG=$(git rev-parse --short HEAD) ./deployment/_push.sh
```

## Helm

Chart: `deployment/watcher`  
Public host: **watcher.donix.dev** (Traefik ingress)

`deployment/live-values.yaml` is gitignored. Start from the tracked example:

```bash
cp deployment/values.example.yaml deployment/live-values.yaml
# edit host, postgresPassword, VAPID keys, image tag, ...
```

```bash
# first install
helm upgrade --install watcher ./deployment/watcher \
  -n watcher --create-namespace \
  -f ./deployment/live-values.yaml

# after a new CI push
helm upgrade watcher ./deployment/watcher \
  -n watcher \
  -f ./deployment/live-values.yaml \
  --set images.tag=sha-<short>
```

### Routing

| Path | Service |
|------|---------|
| `/api`, `/health` | API |
| `/` | Web SPA |

### Secrets

Default chart creates Secret `watcher` when `secret.create: true` (keys: `postgres-password`, `database-url`, `api-token`, VAPID keys).  
Set `secret.create: false` and supply an existing secret with the same keys if you manage secrets yourself.

Generate VAPID keys once and keep them stable:

```bash
cd apps/api && bunx web-push generate-vapid-keys
```

Leave `vapidPublicKey` / `vapidPrivateKey` empty to run without web push.

### Notes

- Scraper is ClusterIP only (no Ingress); API talks to it in-cluster.
- Scraper mounts `emptyDir` Memory on `/dev/shm` for Chromium.
- TLS secret `watcher-tls` is expected to already exist (cert-manager / Traefik).
- If the Docker Hub repositories are private, add an `imagePullSecret` to the chart/deployments.
