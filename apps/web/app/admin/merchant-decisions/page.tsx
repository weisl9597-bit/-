import React from 'react';
import { MerchantDecisionsClient } from '../../../components/admin/merchant-decisions-client';
import { AppShell } from '../../../components/navigation/app-shell';

export default function MerchantDecisionsPage() {
  return <AppShell><MerchantDecisionsClient /></AppShell>;
}
