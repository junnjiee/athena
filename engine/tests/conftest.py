import pytest

from athena import agent


@pytest.fixture(autouse=True)
def _reset_agent_client_cache():
    """Give every test its own model client.

    `agent._structured_client` is cached so a run reuses one connection pool
    instead of building one per soldier per tick. That cache is keyed by model
    name only, so without this a test's monkeypatched ChatOpenRouter would leak
    into every later test that asks for the same model.
    """
    agent._structured_client.cache_clear()
    yield
    agent._structured_client.cache_clear()
