import React from 'react';
import { MetricsCenterClient } from '../../components/metrics/metrics-center-client';
import { AppShell } from '../../components/navigation/app-shell';

export default function MetricsPage() {
  return <AppShell><MetricsCenterClient /></AppShell>;
}
