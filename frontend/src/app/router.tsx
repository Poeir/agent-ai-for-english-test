import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { JobDetailPage } from "../pages/JobDetailPage";
import { JobsPage } from "../pages/JobsPage";
import { PaperCreatePage } from "../pages/PaperCreatePage";
import { PaperDetailPage } from "../pages/PaperDetailPage";
import { PaperListPage } from "../pages/PaperListPage";
import { SessionResultPage } from "../pages/SessionResultPage";
import { SessionTakePage } from "../pages/SessionTakePage";
import { SingleQuestionPage } from "../pages/SingleQuestionPage";

const basename = window.location.pathname.startsWith("/ui") ? "/ui" : undefined;

export const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [
        { index: true, element: <Navigate to="/questions/new" replace /> },
        { path: "/index.html", element: <Navigate to="/questions/new" replace /> },
        { path: "/papers.html", element: <Navigate to="/papers/new" replace /> },
        { path: "/jobs.html", element: <Navigate to="/jobs" replace /> },
        { path: "/questions/new", element: <SingleQuestionPage /> },
        { path: "/papers/new", element: <PaperCreatePage /> },
        { path: "/papers", element: <PaperListPage /> },
        { path: "/papers/:paperId", element: <PaperDetailPage /> },
        { path: "/jobs", element: <JobsPage /> },
        { path: "/jobs/:jobId", element: <JobDetailPage /> },
        { path: "/sessions/take", element: <SessionTakePage /> },
        { path: "/sessions/:sessionId/result", element: <SessionResultPage /> },
        { path: "*", element: <Navigate to="/questions/new" replace /> },
      ],
    },
  ],
  { basename },
);
