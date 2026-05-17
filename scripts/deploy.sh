#!/usr/bin/env bash
# scripts/deploy.sh
#
# Usage:
#   ./scripts/deploy.sh local
#   ./scripts/deploy.sh staging aws
#   ./scripts/deploy.sh staging azure
#   ./scripts/deploy.sh staging vercel
#   ./scripts/deploy.sh production aws
#   ./scripts/deploy.sh production azure
#   ./scripts/deploy.sh production vercel

set +e

source .agent/config/agent.config

TARGET="${1:-local}"
PROVIDER="${2:-}"
DATE=$(date +%Y-%m-%d_%H-%M)

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

header()  { echo -e "\n${BLUE}── $1 ──${NC}"; }
ok()      { echo -e "${GREEN}✓ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
error()   { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Docker Compose command detection ─────────────────────────
# Prefer 'docker compose' (v2 plugin); fall back to 'docker-compose' (v1 binary)
if docker compose version &>/dev/null; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  error "Docker Compose not found. Install Docker Desktop or the 'compose' plugin."
fi

# ── Colima support ───────────────────────────────────────────
# If on macOS and using Colima, ensure DOCKER_HOST is set correctly
if [[ "$OSTYPE" == "darwin"* ]] && command -v colima &>/dev/null; then
  if [ -z "$DOCKER_HOST" ]; then
    COLIMA_SOCKET="$HOME/.colima/default/docker.sock"
    if [ -S "$COLIMA_SOCKET" ]; then
      export DOCKER_HOST="unix://$COLIMA_SOCKET"
      ok "Using Colima socket: $COLIMA_SOCKET"
    fi
  fi
fi

# Verify Docker connection
if ! docker info &>/dev/null; then
  warn "Docker daemon not reachable. If using Colima, run 'colima start'."
  warn "If using Docker Desktop, ensure it is running."
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}  Deploy — target: $TARGET ${PROVIDER:+($PROVIDER)}${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo ""

# ══════════════════════════════════════════════════════════════
# LOCAL
# ══════════════════════════════════════════════════════════════
if [ "$TARGET" = "local" ]; then

  # ── 0. Pre-flight: warn about missing required env vars ─────
  header "0. Pre-flight checks"
  # Load .env so pre-flight sees the same vars docker-compose will use
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  MISSING_VARS=()
  for var in SESSION_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
             S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
    [ -z "${!var}" ] && MISSING_VARS+=("$var")
  done
  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    warn "Missing env vars — app will start but some features will not work:"
    for v in "${MISSING_VARS[@]}"; do
      echo "    $v"
    done
    echo "  Set them in a .env file or export before running."
  else
    ok "Required env vars present"
  fi

  # ── 1. Stop existing containers ─────────────────────────────
  header "1. Stopping existing containers"
  $DC down || warn "Failed to stop containers — they might not be running."
  ok "Stopped"

  # ── 2. Build ─────────────────────────────────────────────────
  header "2. Building"
  $DC build || error "Docker build failed — check Dockerfile and try again"
  ok "Build complete"

  # ── 3. Start database, wait for healthcheck ─────────────────
  header "3. Starting database"
  $DC up -d postgres || error "Failed to start postgres service"

  echo "  Waiting for PostgreSQL to be healthy..."
  MAX_WAIT=30
  WAITED=0
  until $DC exec -T postgres pg_isready -U app -d app_dev &>/dev/null; do
    sleep 1
    WAITED=$((WAITED + 1))
    [ $WAITED -ge $MAX_WAIT ] && error "PostgreSQL did not become healthy within ${MAX_WAIT}s"
  done
  ok "Database healthy (${WAITED}s)"

  # ── 4. Run migrations (via db container — psql is available there) ──
  # Migrations are mounted at /docker-entrypoint-initdb.d in the db container.
  # CREATE TABLE IF NOT EXISTS makes every migration idempotent (safe to re-run).
  header "4. Running migrations"
  $DC exec -T postgres sh -c \
    'for f in /docker-entrypoint-initdb.d/*.sql; do
       echo "  → $(basename "$f")"
       psql -U app -d app_dev -f "$f" > /tmp/migrate.log 2>&1
       RET=$?
       if [ $RET -ne 0 ]; then
         if grep -q "already exists" /tmp/migrate.log; then
           echo "    (already applied)"
         else
           cat /tmp/migrate.log
           exit 1
         fi
       fi
     done' \
  && ok "Migrations complete" \
  || error "Migration step failed — check db/migrations/*.sql"

  # ── 5. Seed (only if file exists) ───────────────────────────
  if [ "$LOCAL_SEED" = "true" ]; then
    header "5. Seeding data"
    if [ -f db/seeds/seed.sql ]; then
      $DC exec -T postgres psql -U app -d app_dev \
        < db/seeds/seed.sql \
      && ok "Seed complete" \
      || warn "Seed script failed — continuing"
    else
      warn "LOCAL_SEED=true but db/seeds/seed.sql not found — skipping"
    fi
  fi

  # ── 6. Start app ─────────────────────────────────────────────
  header "6. Starting app"
  $DC up -d || error "Failed to start app service"
  ok "App running at http://localhost:${LOCAL_PORT:-3000}"

  echo ""
  echo "  Logs  : $DC logs -f app"
  echo "  Shell : $DC exec app sh"
  echo "  Stop  : $DC down"
  echo ""
  exit 0
fi

# ══════════════════════════════════════════════════════════════
# STAGING / PRODUCTION — determine provider
# ══════════════════════════════════════════════════════════════
if [ "$TARGET" = "staging" ] || [ "$TARGET" = "production" ]; then
  ENV_PREFIX=$(echo "$TARGET" | tr '[:lower:]' '[:upper:]')  # STAGING or PROD

  # Resolve provider from arg or config
  if [ -z "$PROVIDER" ]; then
    CONFIG_KEY="${ENV_PREFIX}_TARGET"
    PROVIDER="${!CONFIG_KEY}"
  fi

  [ -z "$PROVIDER" ] && error "No provider specified. Usage: deploy.sh $TARGET aws|azure|vercel"

  # Get env-specific vars
  DB_URL_KEY="${ENV_PREFIX}_${PROVIDER^^}_RDS_URL"
  DB_URL="${!DB_URL_KEY:-${!ENV_PREFIX}_AZURE_DB_URL}"

  echo "  Environment : $TARGET"
  echo "  Provider    : $PROVIDER"
  echo "  Timestamp   : $DATE"
  echo ""

  # ── AWS ──────────────────────────────────────────────────────
  if [ "$PROVIDER" = "aws" ]; then
    REGION_KEY="${ENV_PREFIX}_AWS_REGION"
    ECR_KEY="${ENV_PREFIX}_AWS_ECR"
    CLUSTER_KEY="${ENV_PREFIX}_AWS_ECS_CLUSTER"
    SERVICE_KEY="${ENV_PREFIX}_AWS_ECS_SERVICE"

    REGION="${!REGION_KEY}"
    ECR="${!ECR_KEY}"
    CLUSTER="${!CLUSTER_KEY}"
    SERVICE="${!SERVICE_KEY}"
    IMAGE="$ECR/BlogEngine:$TARGET-$DATE"

    header "1. Building Docker image"
    docker build -t "$IMAGE" .
    ok "Built: $IMAGE"

    header "2. Pushing to ECR"
    aws ecr get-login-password --region "$REGION" | \
      docker login --username AWS --password-stdin "$ECR"
    docker push "$IMAGE"
    ok "Pushed to ECR"

    header "3. Running migrations"
    aws ecs run-task \
      --cluster "$CLUSTER" \
      --task-definition BlogEngine-migrate \
      --overrides "{\"containerOverrides\":[{\"name\":\"web\",\"command\":[\"sh\",\"-c\",\"for f in db/migrations/*.sql; do psql \$DATABASE_URL -f \$f; done\"]}]}" \
      --launch-type FARGATE \
      --network-configuration "awsvpcConfiguration={subnets=[$(aws ec2 describe-subnets --query 'Subnets[0].SubnetId' --output text)],assignPublicIp=ENABLED}" \
      --region "$REGION" 2>&1
    ok "Migrations complete"

    header "4. Updating ECS service"
    aws ecs update-service \
      --cluster "$CLUSTER" \
      --service "$SERVICE" \
      --force-new-deployment \
      --region "$REGION"
    ok "Deployment triggered"

    header "5. Waiting for service stability"
    aws ecs wait services-stable \
      --cluster "$CLUSTER" \
      --services "$SERVICE" \
      --region "$REGION"
    ok "Service stable ✓"
  fi

  # ── AZURE ────────────────────────────────────────────────────
  if [ "$PROVIDER" = "azure" ]; then
    RG_KEY="${ENV_PREFIX}_AZURE_RG"
    APP_KEY="${ENV_PREFIX}_AZURE_APP"
    RG="${!RG_KEY}"
    APP="${!APP_KEY}"

    header "1. Building Docker image"
    ACR=$(az acr list --resource-group "$RG" --query '[0].loginServer' -o tsv)
    IMAGE="$ACR/BlogEngine:$TARGET-$DATE"
    docker build -t "$IMAGE" .
    ok "Built: $IMAGE"

    header "2. Pushing to ACR"
    az acr login --name "$(echo $ACR | cut -d. -f1)"
    docker push "$IMAGE"
    ok "Pushed to ACR"

    header "3. Running migrations"
    az webapp ssh --resource-group "$RG" --name "$APP" \
      --command "for f in db/migrations/*.sql; do psql \$DATABASE_URL -f \$f; done"
    ok "Migrations complete"

    header "4. Deploying to App Service"
    az webapp config container set \
      --resource-group "$RG" \
      --name "$APP" \
      --docker-custom-image-name "$IMAGE"
    az webapp restart --resource-group "$RG" --name "$APP"
    ok "Deployed to Azure App Service"
  fi

  # ── VERCEL ───────────────────────────────────────────────────
  if [ "$PROVIDER" = "vercel" ]; then
    PROJECT_KEY="${ENV_PREFIX}_VERCEL_PROJECT"
    ENV_KEY="${ENV_PREFIX}_VERCEL_ENV"
    PROJECT="${!PROJECT_KEY}"
    VERCEL_ENV="${!ENV_KEY}"

    header "1. Running migrations (via Vercel env DB)"
    [ -n "$DB_URL" ] && \
      for f in db/migrations/*.sql; do
        psql "$DB_URL" -f "$f"
      done
    ok "Migrations complete"

    header "2. Deploying to Vercel"
    if [ "$VERCEL_ENV" = "production" ]; then
      vercel deploy --prod --project "$PROJECT"
    else
      vercel deploy --project "$PROJECT"
    fi
    ok "Deployed to Vercel"
  fi

  echo ""
  echo -e "${GREEN}══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Deploy complete: $TARGET ($PROVIDER)${NC}"
  echo -e "${GREEN}══════════════════════════════════════════${NC}"
  echo ""
  exit 0
fi

echo "Unknown target: $TARGET"
echo "Usage: ./scripts/deploy.sh local|staging|production [aws|azure|vercel]"
exit 1
