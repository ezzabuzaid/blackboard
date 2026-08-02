#!/usr/bin/env bash
set -Eeuo pipefail

project_name=Baseera
compose_name=baseera
volume_name=baseera-data
dokploy_url=${DOKPLOY_URL:-https://dokploy.limerence.sh}
ssh_host=${DOKPLOY_SSH_HOST:-root@167.233.88.12}
chatgpt_model=${CHATGPT_MODEL:-gpt-5.6-sol}
token_file=${CHATGPT_TOKEN_FILE:-apps/api/.data/zukhruf/chatgpt.json}
deploy_domain=${DEPLOY_DOMAIN:-}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
compose_file=$root/deploy/dokploy/compose.yml
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/baseera-deploy.XXXXXX")
smoke_container=
smoke_volume=

cleanup() {
  if [[ -n $smoke_container ]]; then
    ssh "$ssh_host" docker rm -f "$smoke_container" >/dev/null 2>&1 || true
  fi
  if [[ -n $smoke_volume ]]; then
    ssh "$ssh_host" docker volume rm "$smoke_volume" >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

for command in curl git jq node npx ssh tar; do
  command -v "$command" >/dev/null || fail "$command is required"
done

if [[ -z ${DOKPLOY_API_KEY:-} && -f $root/apps/api/.env ]]; then
  DOKPLOY_API_KEY=$(node --env-file="$root/apps/api/.env" \
    --print 'process.env.DOKPLOY_API_KEY ?? ""')
fi
[[ -n ${DOKPLOY_API_KEY:-} ]] || fail "DOKPLOY_API_KEY is required"
[[ -s $token_file ]] || fail "ChatGPT credentials not found at $token_file"

dokploy_url=${dokploy_url%/}
dokploy_url=${dokploy_url%/api}

run_logged() {
  local label=$1
  shift
  local log
  log=$temp_dir/$(printf '%s' "$label" | tr ' /' '__').log
  printf '→ %s\n' "$label"
  if ! "$@" >"$log" 2>&1; then
    tail -n 100 "$log" >&2
    fail "$label failed"
  fi
  printf '✓ %s\n' "$label"
}

dokploy_post() {
  local procedure=$1
  local payload=$2
  local response
  if ! response=$(curl --silent --show-error --fail-with-body \
    --request POST "$dokploy_url/api/$procedure" \
    --header "x-api-key: $DOKPLOY_API_KEY" \
    --header 'content-type: application/json' \
    --data "$payload"); then
    printf '%s\n' "$response" | jq -r '.error.json.message // .message // .' >&2 2>/dev/null || true
    return 1
  fi
  printf '%s\n' "$response"
}

dokploy_query() {
  local procedure=$1
  local payload=${2:-}
  local url=$dokploy_url/api/$procedure
  local response
  if [[ -n $payload ]]; then
    local query
    query=$(printf '%s\n' "$payload" | jq -r \
      'to_entries | map("\(.key)=\(.value | tostring | @uri)") | join("&")')
    url="$url?$query"
  fi
  if ! response=$(curl --silent --show-error --fail-with-body \
    "$url" --header "x-api-key: $DOKPLOY_API_KEY"); then
    printf '%s\n' "$response" | jq -r '.error.json.message // .message // .' >&2 2>/dev/null || true
    return 1
  fi
  printf '%s\n' "$response"
}

cd "$root"

if [[ -n ${BASEERA_IMAGE:-} ]]; then
  [[ $BASEERA_IMAGE =~ ^baseera:[[:alnum:]_.-]+$ ]] \
    || fail "BASEERA_IMAGE must be a baseera image tag"
  image=$BASEERA_IMAGE
  deployment_id=${image#baseera:}
  ssh "$ssh_host" docker image inspect "$image" >/dev/null \
    || fail "$image does not exist on $ssh_host"
  printf '✓ using remote image %s\n' "$image"
else
  run_logged "api typecheck" npx nx run api:typecheck
  run_logged "web typecheck" npx nx run web:typecheck
  run_logged "api tests" npx nx run api:test
  run_logged "web tests" npx nx run web:test

  deployment_id=$(printf '%s-%s' \
    "$(git rev-parse --short=12 HEAD)" "$(date -u +%Y%m%d%H%M%S)")
  image=baseera:$deployment_id

  printf '→ build container on Dokploy host\n'
  build_log=$temp_dir/remote_container_build.log
  if ! tar \
    --exclude .git \
    --exclude .nx \
    --exclude .data \
    --exclude dist \
    --exclude node_modules \
    -cf - . \
    | ssh "$ssh_host" "docker build --file deploy/dokploy/Dockerfile --tag '$image' -" \
      >"$build_log" 2>&1; then
    tail -n 100 "$build_log" >&2
    fail "remote container build failed"
  fi
  printf '✓ build container on Dokploy host\n'
fi

smoke_container=baseera-smoke-$deployment_id
smoke_volume=baseera-smoke-$deployment_id
ssh "$ssh_host" "docker volume create '$smoke_volume'" >/dev/null
ssh "$ssh_host" "docker run --rm -i --volume '$smoke_volume:/data' '$image' sh -ceu 'umask 077; mkdir -p /data/zukhruf; cat > /data/zukhruf/chatgpt.json'" <"$token_file"
ssh "$ssh_host" "docker run --detach --rm --name '$smoke_container' --env WEB_ORIGIN=http://127.0.0.1 --volume '$smoke_volume:/data' '$image'" >/dev/null
for _ in {1..30}; do
  if ssh "$ssh_host" "docker exec '$smoke_container' node --input-type=module --eval 'const [health, html] = await Promise.all([fetch(\"http://127.0.0.1:3001/api/health\"), fetch(\"http://127.0.0.1:3001/\")]); if (!health.ok || !(await html.text()).includes(\"<div id=\\\"root\\\"></div>\")) process.exit(1)'" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
ssh "$ssh_host" "docker exec '$smoke_container' node --input-type=module --eval 'const [health, html] = await Promise.all([fetch(\"http://127.0.0.1:3001/api/health\"), fetch(\"http://127.0.0.1:3001/\")]); if (!health.ok || !(await html.text()).includes(\"<div id=\\\"root\\\"></div>\")) process.exit(1)'" >/dev/null \
  || fail "remote app smoke test failed"
ssh "$ssh_host" docker rm -f "$smoke_container" >/dev/null
smoke_container=
ssh "$ssh_host" docker volume rm "$smoke_volume" >/dev/null
smoke_volume=
printf '✓ remote app smoke test\n'

ssh "$ssh_host" "docker volume create '$volume_name'" >/dev/null
ssh "$ssh_host" "docker run --rm -i --volume '$volume_name:/data' '$image' sh -ceu 'test -s /data/zukhruf/chatgpt.json && exit 0; umask 077; mkdir -p /data/zukhruf; cat > /data/zukhruf/chatgpt.json'" <"$token_file"
printf '✓ ChatGPT credentials available in the persistent deployment volume\n'

projects=$(dokploy_query project.all)
project_count=$(printf '%s\n' "$projects" | jq --arg name "$project_name" '[.[] | select(.name == $name)] | length')
[[ $project_count -le 1 ]] || fail "multiple Dokploy projects are named $project_name"

if [[ $project_count -eq 0 ]]; then
  created=$(dokploy_post project.create "$(jq -cn \
    --arg name "$project_name" \
    '{name:$name,description:"One-off Baseera deployment"}')")
  project=$(printf '%s\n' "$created" | jq '.project')
  environment=$(printf '%s\n' "$created" | jq '.environment')
  printf '✓ created Dokploy project %s\n' "$project_name"
else
  project=$(printf '%s\n' "$projects" | jq --arg name "$project_name" '.[] | select(.name == $name)')
  environment=$(printf '%s\n' "$project" | jq '[.environments[] | select(.isDefault == true)] | first // empty')
  [[ -n $environment ]] || fail "$project_name has no default environment"
  printf '✓ using existing Dokploy project %s\n' "$project_name"
fi

environment_id=$(printf '%s\n' "$environment" | jq -er '.environmentId')
compose=$(printf '%s\n' "$environment" | jq --arg name "$compose_name" '.compose[]? | select(.name == $name)')
compose_count=$(printf '%s\n' "$environment" | jq --arg name "$compose_name" '[.compose[]? | select(.name == $name)] | length')
[[ $compose_count -le 1 ]] || fail "multiple compose services are named $compose_name"
raw_compose=$(<"$compose_file")

if [[ $compose_count -eq 0 ]]; then
  compose=$(dokploy_post compose.create "$(jq -cn \
    --arg name "$compose_name" \
    --arg environmentId "$environment_id" \
    --arg composeFile "$raw_compose" \
    '{name:$name,description:"Baseera app",environmentId:$environmentId,composeType:"docker-compose",composeFile:$composeFile}')")
  printf '✓ created Dokploy compose service %s\n' "$compose_name"
fi

compose_id=$(printf '%s\n' "$compose" | jq -er '.composeId')
dokploy_post compose.update "$(jq -cn \
  --arg composeId "$compose_id" \
  --arg composeFile "$raw_compose" \
  '{composeId:$composeId,composeFile:$composeFile,sourceType:"raw"}')" >/dev/null

domains=$(dokploy_query domain.byComposeId "$(jq -cn --arg composeId "$compose_id" '{composeId:$composeId}')")
if [[ -z $deploy_domain ]]; then
  deploy_domain=$(printf '%s\n' "$domains" \
    | jq -r '[.[] | select(.serviceName == "app" and .path == "/")] | first | .host // empty')
  if [[ -z $deploy_domain ]]; then
    deploy_domain=$(dokploy_post domain.generateDomain '{"appName":"baseera"}' | jq -er '.')
  fi
fi
web_origin=https://$deploy_domain
compose_env=$(printf 'DEPLOY_IMAGE=%s\nWEB_ORIGIN=%s\nCHATGPT_MODEL=%s\n' \
  "$image" "$web_origin" "$chatgpt_model")
dokploy_post compose.saveEnvironment "$(jq -cn \
  --arg composeId "$compose_id" \
  --arg env "$compose_env" \
  '{composeId:$composeId,env:$env}')" >/dev/null

domain=$(printf '%s\n' "$domains" | jq --arg host "$deploy_domain" '[.[] | select(.host == $host and .path == "/")] | first // empty')
domain_payload=$(jq -cn \
  --arg host "$deploy_domain" \
  --arg composeId "$compose_id" \
  '{host:$host,path:"/",port:3001,https:true,certificateType:"letsencrypt",composeId:$composeId,serviceName:"app",domainType:"compose"}')
if [[ -z $domain ]]; then
  dokploy_post domain.create "$domain_payload" >/dev/null
else
  domain_id=$(printf '%s\n' "$domain" | jq -er '.domainId')
  dokploy_post domain.update "$(printf '%s\n' "$domain_payload" | jq --arg domainId "$domain_id" '. + {domainId:$domainId} | del(.composeId)')" >/dev/null
fi

title="Baseera $deployment_id"
dokploy_post compose.deploy "$(jq -cn \
  --arg composeId "$compose_id" \
  --arg title "$title" \
  '{composeId:$composeId,title:$title,description:"One-off verified deployment"}')" >/dev/null
printf '→ deployment queued\n'

status=
for _ in {1..90}; do
  deployments=$(dokploy_query deployment.allByCompose "$(jq -cn --arg composeId "$compose_id" '{composeId:$composeId}')")
  status=$(printf '%s\n' "$deployments" | jq -r --arg title "$title" '[.[] | select(.title == $title)] | first | .status // empty')
  case $status in
    done) break ;;
    error | cancelled)
      error_message=$(printf '%s\n' "$deployments" | jq -r --arg title "$title" '[.[] | select(.title == $title)] | first | .errorMessage // "deployment failed"')
      fail "$error_message"
      ;;
  esac
  sleep 5
done
[[ $status == "done" ]] || fail "Dokploy deployment did not finish within 7.5 minutes"

for _ in {1..60}; do
  health=$(curl --silent --show-error --fail "$web_origin/api/health" 2>/dev/null || true)
  if [[ $(printf '%s\n' "$health" | jq -r '.status // empty' 2>/dev/null) == ok ]]; then
    printf '✓ deployed and healthy: %s\n' "$web_origin"
    exit 0
  fi
  sleep 5
done

fail "deployment finished but $web_origin/api/health never became healthy"
