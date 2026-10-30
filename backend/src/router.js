/**
 * @module router
 * @description API Gateway HTTP API route dispatcher for the Socks Factory ERP.
 * Maps {method, resource} pairs to Lambda handler exports.
 * Each Lambda function receives the full API Gateway v2 event.
 *
 * Usage (in each Lambda function's index.js entry point):
 *   import { dispatch } from '../../router.js';
 *   export const handler = dispatch;
 */

import * as customers  from './handlers/customers/index.js';
import * as samples    from './handlers/samples/index.js';
import * as products   from './handlers/products/index.js';
import * as bom        from './handlers/bom/index.js';
import * as yarn       from './handlers/yarn-warehouse/index.js';
import * as planning   from './handlers/planning/index.js';
import * as machines   from './handlers/machines/index.js';
import * as mfg        from './handlers/manufacturing/index.js';
import * as employees  from './handlers/employees/index.js';
import * as quality    from './handlers/quality/index.js';
import * as shipping   from './handlers/shipping/index.js';

/**
 * Route table: each entry is [METHOD, path-pattern-regex, handler].
 * Patterns use named groups: (?<id>[^/]+)
 * Evaluated in order — first match wins.
 */
const ROUTES = [
  // ── Customers ──────────────────────────────────────────────────────────────
  ['GET',    /^\/customers$/,                                  customers.listCustomers],
  ['POST',   /^\/customers$/,                                  customers.createCustomer],
  ['GET',    /^\/customers\/(?<id>[^/]+)$/,                    customers.getCustomer],
  ['PUT',    /^\/customers\/(?<id>[^/]+)$/,                    customers.updateCustomer],
  ['DELETE', /^\/customers\/(?<id>[^/]+)$/,                    customers.deleteCustomer],
  ['GET',    /^\/customers\/(?<id>[^/]+)\/contacts$/,          customers.listContacts],
  ['POST',   /^\/customers\/(?<id>[^/]+)\/contacts$/,          customers.createContact],
  ['GET',    /^\/customers\/(?<id>[^/]+)\/addresses$/,         customers.listAddresses],
  ['POST',   /^\/customers\/(?<id>[^/]+)\/addresses$/,         customers.createAddress],

  // ── Samples ────────────────────────────────────────────────────────────────
  ['GET',    /^\/samples$/,                                    samples.listSampleRequests],
  ['POST',   /^\/samples$/,                                    samples.createSampleRequest],
  ['GET',    /^\/samples\/(?<id>[^/]+)$/,                      samples.getSampleRequest],
  ['PUT',    /^\/samples\/(?<id>[^/]+)$/,                      samples.updateSampleRequest],
  ['POST',   /^\/samples\/(?<id>[^/]+)\/submit$/,              samples.submitSampleRequest],
  ['POST',   /^\/samples\/(?<id>[^/]+)\/versions$/,            samples.createSampleVersion],
  ['POST',   /^\/samples\/(?<id>[^/]+)\/approve$/,             samples.approveSample],
  ['POST',   /^\/samples\/(?<id>[^/]+)\/reject$/,              samples.rejectSample],

  // ── Products ───────────────────────────────────────────────────────────────
  ['GET',    /^\/products\/categories$/,                       products.listCategories],
  ['GET',    /^\/products$/,                                   products.listProducts],
  ['POST',   /^\/products$/,                                   products.createProduct],
  ['GET',    /^\/products\/(?<id>[^/]+)$/,                     products.getProduct],
  ['PUT',    /^\/products\/(?<id>[^/]+)$/,                     products.updateProduct],
  ['DELETE', /^\/products\/(?<id>[^/]+)$/,                     products.deleteProduct],
  ['GET',    /^\/products\/(?<id>[^/]+)\/variants$/,           products.listVariants],
  ['POST',   /^\/products\/(?<id>[^/]+)\/variants$/,           products.createVariant],

  // ── BOM ────────────────────────────────────────────────────────────────────
  ['GET',    /^\/bom\/(?<product_id>[^/]+)\/versions$/,        bom.listBOMVersions],
  ['GET',    /^\/bom\/(?<product_id>[^/]+)\/cost$/,            bom.getBOMCost],
  ['GET',    /^\/bom\/(?<product_id>[^/]+)$/,                  bom.getBOM],
  ['POST',   /^\/bom$/,                                        bom.createBOM],
  ['PUT',    /^\/bom\/(?<id>[^/]+)$/,                          bom.updateBOM],
  ['POST',   /^\/bom\/(?<id>[^/]+)\/activate$/,                bom.activateBOM],
  ['POST',   /^\/bom\/(?<id>[^/]+)\/deactivate$/,              bom.deactivateBOM],

  // ── Yarn Warehouse ─────────────────────────────────────────────────────────
  ['GET',    /^\/yarn\/summary$/,                              yarn.getStockSummary],
  ['GET',    /^\/yarn\/locations$/,                            yarn.listLocations],
  ['POST',   /^\/yarn\/receipts$/,                             yarn.receiveYarn],
  ['POST',   /^\/yarn\/issues$/,                               yarn.issueYarn],
  ['POST',   /^\/yarn\/adjustments$/,                          yarn.adjustStock],
  ['GET',    /^\/yarn$/,                                       yarn.listYarnItems],
  ['POST',   /^\/yarn$/,                                       yarn.createYarnItem],
  ['GET',    /^\/yarn\/(?<id>[^/]+)$/,                         yarn.getYarnItem],
  ['PUT',    /^\/yarn\/(?<id>[^/]+)$/,                         yarn.updateYarnItem],

  // ── Planning ───────────────────────────────────────────────────────────────
  ['GET',    /^\/planning\/calendar$/,                         planning.getScheduleCalendar],
  ['GET',    /^\/planning\/capacity$/,                         planning.listCapacityPlans],
  ['GET',    /^\/planning\/orders$/,                           planning.listProductionOrders],
  ['POST',   /^\/planning\/orders$/,                           planning.createProductionOrder],
  ['GET',    /^\/planning\/orders\/(?<id>[^/]+)$/,             planning.getProductionOrder],
  ['PUT',    /^\/planning\/orders\/(?<id>[^/]+)$/,             planning.updateProductionOrder],
  ['POST',   /^\/planning\/orders\/(?<id>[^/]+)\/confirm$/,    planning.confirmOrder],
  ['POST',   /^\/planning\/orders\/(?<id>[^/]+)\/cancel$/,     planning.cancelOrder],
  ['POST',   /^\/planning\/orders\/(?<id>[^/]+)\/schedule$/,   planning.scheduleOrder],

  // ── Machines ───────────────────────────────────────────────────────────────
  ['GET',    /^\/machines\/stats$/,                            machines.getMachineStats],
  ['GET',    /^\/machines$/,                                   machines.listMachines],
  ['POST',   /^\/machines$/,                                   machines.createMachine],
  ['GET',    /^\/machines\/(?<id>[^/]+)$/,                     machines.getMachine],
  ['PUT',    /^\/machines\/(?<id>[^/]+)$/,                     machines.updateMachine],
  ['POST',   /^\/machines\/(?<id>[^/]+)\/retire$/,             machines.retireMachine],
  ['GET',    /^\/machines\/(?<id>[^/]+)\/maintenance$/,        machines.listMaintenance],
  ['POST',   /^\/machines\/(?<id>[^/]+)\/maintenance$/,        machines.logMaintenance],
  ['GET',    /^\/machines\/(?<id>[^/]+)\/downtime$/,           machines.listDowntime],
  ['POST',   /^\/machines\/(?<id>[^/]+)\/downtime$/,           machines.logDowntime],
  ['POST',   /^\/machines\/(?<id>[^/]+)\/downtime\/(?<downtime_id>[^/]+)\/close$/, machines.closeDowntime],

  // ── Manufacturing ──────────────────────────────────────────────────────────
  ['GET',    /^\/manufacturing\/summary$/,                     mfg.getProductionSummary],
  ['GET',    /^\/manufacturing$/,                              mfg.listWorkOrders],
  ['POST',   /^\/manufacturing$/,                              mfg.createWorkOrder],
  ['GET',    /^\/manufacturing\/(?<id>[^/]+)$/,                mfg.getWorkOrder],
  ['POST',   /^\/manufacturing\/(?<id>[^/]+)\/start$/,         mfg.startWorkOrder],
  ['POST',   /^\/manufacturing\/(?<id>[^/]+)\/log$/,           mfg.logProduction],
  ['POST',   /^\/manufacturing\/(?<id>[^/]+)\/complete$/,      mfg.completeWorkOrder],
  ['POST',   /^\/manufacturing\/(?<id>[^/]+)\/cancel$/,        mfg.cancelWorkOrder],
  ['POST',   /^\/manufacturing\/(?<id>[^/]+)\/assign-machine$/, mfg.assignMachine],
  ['GET',    /^\/manufacturing\/(?<id>[^/]+)\/logs$/,          mfg.listProductionLogs],

  // ── Employees ──────────────────────────────────────────────────────────────
  ['POST',   /^\/employees\/kpis$/,                            employees.setKPI],
  ['GET',    /^\/employees$/,                                  employees.listEmployees],
  ['POST',   /^\/employees$/,                                  employees.createEmployee],
  ['GET',    /^\/employees\/(?<id>[^/]+)$/,                    employees.getEmployee],
  ['PUT',    /^\/employees\/(?<id>[^/]+)$/,                    employees.updateEmployee],
  ['POST',   /^\/employees\/(?<id>[^/]+)\/terminate$/,         employees.terminateEmployee],
  ['GET',    /^\/employees\/(?<id>[^/]+)\/attendance$/,        employees.listAttendance],
  ['POST',   /^\/employees\/(?<id>[^/]+)\/attendance$/,        employees.recordAttendance],
  ['POST',   /^\/employees\/(?<id>[^/]+)\/kpi-results$/,       employees.recordKPIResult],
  ['GET',    /^\/employees\/(?<id>[^/]+)\/performance$/,       employees.getPerformanceSummary],

  // ── Quality Control ────────────────────────────────────────────────────────
  ['GET',    /^\/quality\/stats$/,                             quality.getQualityStats],
  ['GET',    /^\/quality\/plans$/,                             quality.listQCPlans],
  ['POST',   /^\/quality\/plans$/,                             quality.createQCPlan],
  ['GET',    /^\/quality\/plans\/(?<id>[^/]+)$/,               quality.getQCPlan],
  ['PUT',    /^\/quality\/plans\/(?<id>[^/]+)$/,               quality.updateQCPlan],
  ['POST',   /^\/quality\/plans\/(?<id>[^/]+)\/checkpoints$/,  quality.addCheckpoint],
  ['POST',   /^\/quality\/inspections$/,                       quality.runQCInspection],
  ['GET',    /^\/quality\/inspections$/,                       quality.listInspections],
  ['GET',    /^\/quality\/inspections\/(?<id>[^/]+)$/,         quality.getInspection],
  ['GET',    /^\/quality\/non-conformances$/,                  quality.listNonConformances],
  ['POST',   /^\/quality\/non-conformances\/(?<id>[^/]+)\/resolve$/, quality.resolveNonConformance],

  // ── Shipping ───────────────────────────────────────────────────────────────
  ['GET',    /^\/shipping\/stats$/,                            shipping.getShippingStats],
  ['GET',    /^\/shipping\/carriers$/,                         shipping.listCarriers],
  ['POST',   /^\/shipping\/carriers$/,                         shipping.createCarrier],
  ['GET',    /^\/shipping\/packing-lists$/,                    shipping.listPackingLists],
  ['POST',   /^\/shipping\/packing-lists$/,                    shipping.createPackingList],
  ['GET',    /^\/shipping\/packing-lists\/(?<id>[^/]+)$/,      shipping.getPackingList],
  ['GET',    /^\/shipping$/,                                   shipping.listShipments],
  ['POST',   /^\/shipping$/,                                   shipping.createShipment],
  ['GET',    /^\/shipping\/(?<id>[^/]+)$/,                     shipping.getShipment],
  ['POST',   /^\/shipping\/(?<id>[^/]+)\/status$/,             shipping.updateShipmentStatus],
];

/**
 * Main dispatcher — resolves the route, injects parsed path parameters,
 * and calls the matching handler. Returns 404 if no route matches.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event
 * @param {import('aws-lambda').Context} context
 */
export async function dispatch(event, context) {
  const method  = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.rawPath ?? event.path ?? '/';

  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = rawPath.match(pattern);
    if (!match) continue;

    // Merge regex named groups into pathParameters
    event.pathParameters = { ...(event.pathParameters ?? {}), ...(match.groups ?? {}) };

    try {
      return await handler(event, context);
    } catch (err) {
      console.error('[router] Unhandled error', { method, rawPath, err });
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: `No route: ${method} ${rawPath}` }),
  };
}
