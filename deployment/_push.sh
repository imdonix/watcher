#!/usr/bin/env bash
#
# Build and push Watcher runtime images to the private registry.
#
# Usage (from repo root or this directory):
#   ./deployment/_push.sh            # tag = latest
#   ./deployment/_push.sh 1.0.3      # explicit tag
#   TAG=$(git rev-parse --short HEAD) ./deployment/_push.sh
#
# Override registry:
#   REGISTRY=192.168.0.100:32500 ./deployment/_push.sh

set -euo pipefail

REGISTRY="${REGISTRY:-192.168.0.100:32500}"
TAG="${1:-${TAG:-latest}}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# component => Dockerfile under docker/ (build context = monorepo root)
declare -A IMAGES=(
  [watcher-api]="docker/api.Dockerfile"
  [watcher-scraper]="docker/scraper.Dockerfile"
  [watcher-web]="docker/web.Dockerfile"
)

COMPONENTS=(watcher-api watcher-scraper watcher-web)

echo "=== Watcher image build & push ==="
echo "Registry : $REGISTRY"
echo "Tag      : $TAG"
echo "Root     : $PROJECT_ROOT"
echo ""

PUSHED=()

for NAME in "${COMPONENTS[@]}"; do
  DOCKERFILE="${IMAGES[$NAME]}"
  FULL_IMAGE="$REGISTRY/$NAME:$TAG"

  if [ ! -f "$DOCKERFILE" ]; then
    echo "❌ Missing Dockerfile: $DOCKERFILE"
    exit 1
  fi

  echo "--- Building $FULL_IMAGE ---"
  echo "    Dockerfile: $DOCKERFILE"

  BUILD_ARGS=()
  if [ "$NAME" = "watcher-web" ]; then
    BUILD_ARGS+=(--build-arg "VITE_API_URL=")
  fi

  docker buildx build \
    --provenance=false \
    --sbom=false \
    --push \
    -f "$DOCKERFILE" \
    -t "$FULL_IMAGE" \
    "${BUILD_ARGS[@]}" \
    .

  echo "✅ Pushed $FULL_IMAGE"
  echo ""
  PUSHED+=("$NAME")
done

echo "========================================"
echo "All images pushed ($TAG)"
echo "========================================"
echo ""
echo "Helm values image refs:"
echo "  images:"
echo "    registry: \"$REGISTRY\""
echo "    api: watcher-api"
echo "    scraper: watcher-scraper"
echo "    web: watcher-web"
echo "    tag: \"$TAG\""
echo ""
echo "Deploy example:"
echo "  helm upgrade --install watcher ./deployment/watcher \\"
echo "    -n watcher --create-namespace \\"
echo "    -f ./deployment/live-values.yaml \\"
echo "    --set images.tag=$TAG"
echo ""

echo "Verifying tags in registry..."
for REPO in "${PUSHED[@]}"; do
  echo "Repository: $REGISTRY/$REPO"
  RESPONSE=$(curl -s -w "\nHTTPSTATUS:%{http_code}" "http://$REGISTRY/v2/$REPO/tags/list" || true)
  BODY=$(echo "$RESPONSE" | sed -e 's/HTTPSTATUS\:.*//g')
  STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

  if [ "$STATUS" = "200" ]; then
    TAGS=$(echo "$BODY" | jq -r '.tags[]?' 2>/dev/null || true)
    if [ -n "$TAGS" ]; then
      echo "   Tags:"
      echo "$TAGS" | sed 's/^/      • /'
    else
      echo "   (no tags listed)"
    fi
  else
    echo "   Could not list tags (HTTP ${STATUS:-unknown})"
  fi
  echo ""
done

echo "Done."
