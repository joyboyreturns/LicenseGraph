#!/bin/sh
# Runs once, the first time the database volume is created. Gives the identity provider its own database and role
# inside the same PostgreSQL server, so one server (one set of memory buffers) serves both.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '${IDENTITY_DATABASE_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;
SQL
