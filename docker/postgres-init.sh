#!/bin/sh
# The terrain service and the simulation engine own separate schemas and manage
# them separately (Drizzle migrations vs. the engine's own CREATE TABLE on
# startup), so they get a database each rather than sharing one namespace.
# Runs once, on first initialisation of the postgres volume.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE athena_engine;
EOSQL
