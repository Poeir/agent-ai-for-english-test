"""In-memory registry of running generation-pipeline tasks.

Used so the cancel endpoint can find the asyncio.Task for a given job_id and
cancel it. Survives only as long as the process — restarting the backend loses
the registry, but any in-flight tasks die with the process anyway.
"""
import asyncio

_RUNNING_JOBS: dict[str, asyncio.Task] = {}


def register(job_id: str, task: asyncio.Task) -> None:
    _RUNNING_JOBS[job_id] = task


def unregister(job_id: str) -> None:
    _RUNNING_JOBS.pop(job_id, None)


def is_running(job_id: str) -> bool:
    task = _RUNNING_JOBS.get(job_id)
    return task is not None and not task.done()


def cancel(job_id: str) -> bool:
    """Request cancellation of the task; returns True if a live task was signalled."""
    task = _RUNNING_JOBS.get(job_id)
    if task is None or task.done():
        return False
    return task.cancel()
