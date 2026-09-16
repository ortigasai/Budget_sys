from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.models_phase2 import phase2_registry
from app.models_phase3 import phase3_registry
from app.models_phase4 import phase4_registry
# Side-effect import only (models_npc_monitoring.py's classes register into
# phase3_registry, imported above, on import) - without this, autogenerate
# has no way to know these two tables exist, same trap the comment below
# warns about for a registry that's never imported at all.
from app import models_npc_monitoring  # noqa: F401
from app.settings import settings

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Pulled from app/settings.py (same .env the FastAPI app reads) rather than
# duplicated into alembic.ini, so there's one source of truth for the DB URL.
# set_main_option() writes into a configparser section, which treats % as
# its own interpolation escape character (e.g. %(name)s) - a literal % in
# the URL (very possible here: a password containing @, :, etc. gets
# percent-encoded, e.g. @ -> %40) makes configparser raise "invalid
# interpolation syntax" unless every literal % is doubled to %% first.
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Only Phase 2's and Phase 3's own tables are ever known to Alembic - Phase
# 1's Prisma-owned tables (app/models_phase1.py) live in a completely
# separate registry that's never imported here, so autogenerate has no way
# to see them at all. Alembic supports target_metadata as a list of MetaData
# objects (autogenerate diffs against their union).
target_metadata = [phase2_registry.metadata, phase3_registry.metadata, phase4_registry.metadata]
_known_table_names = {name for md in target_metadata for name in md.tables}


def include_object(object, name, type_, reflected, compare_to):
    """Belt-and-suspenders on top of target_metadata already being scoped to
    Phase 2/3 only: even if a future edit accidentally widens target_metadata,
    this refuses anything not explicitly one of those tables.
    """
    if type_ == "table":
        return name in _known_table_names
    return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, include_object=include_object
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
