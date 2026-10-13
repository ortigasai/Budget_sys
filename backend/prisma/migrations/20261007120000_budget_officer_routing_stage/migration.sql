-- Stage after SBU Finance Head Review: the Budget Officer routes the request on to the SBU or Division Head.
ALTER TYPE "RequestStage" ADD VALUE IF NOT EXISTS 'BUDGET_OFFICER_ROUTING';
