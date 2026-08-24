import React from 'react';
import { MetricsCenterClient } from '../../components/metrics/metrics-center-client';
import { AppShell } from '../../components/navigation/app-shell';
import { sourceAwareOperationsEnabled } from '../../lib/operations-rollout';

export const dynamic = 'force-dynamic';

export default function MetricsPage() {
  return <AppShell><MetricsCenterClient sourceAwareEnabled={sourceAwareOperationsEnabled()} /></AppShell>;
}
