from langgraph.graph import END, StateGraph

from app.agents.blueprint_agent import blueprint_node
from app.agents.generator_agent import generator_node
from app.agents.judge_agent import judge_node
from app.agents.state import PipelineState


def build_pipeline():
    g = StateGraph(PipelineState)

    # Node names must not clash with PipelineState keys
    g.add_node("run_blueprint", blueprint_node)
    g.add_node("run_generator", generator_node)
    g.add_node("run_judge", judge_node)

    g.set_entry_point("run_blueprint")
    g.add_edge("run_blueprint", "run_generator")
    g.add_edge("run_generator", "run_judge")
    g.add_edge("run_judge", END)

    return g.compile()


pipeline = build_pipeline()
