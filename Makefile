# Amplio self-host management targets.
# One command to go live: `make deploy`.

COMPOSE := docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env

.PHONY: deploy down logs ps

# Create/keep deploy/.env, build images, start the stack, wait for health.
# Pass a domain on first run with: make deploy DOMAIN=yourdomain.com
deploy:
	./deploy/deploy.sh $(DOMAIN)

# Stop and remove the stack's containers (named volumes are kept).
down:
	$(COMPOSE) down

# Tail logs from all services (Ctrl-C to stop).
logs:
	$(COMPOSE) logs -f

# Show container status.
ps:
	$(COMPOSE) ps
