export type AdminDeliveryLog = {
  orderId: string;
  action: 'delivery-complete';
  elapsedSeconds: number;
  address: string;
  imageUri: string;
  createdAt: string;
};

export type CustomerDeliveryProof = {
  orderId: string;
  address: string;
  imageUri: string;
  deliveredAt: string;
};

const adminDeliveryLogs: AdminDeliveryLog[] = [];
const customerDeliveryProofs: CustomerDeliveryProof[] = [];

export function recordDriverCompletion(payload: {
  orderId: string;
  elapsedSeconds: number;
  address: string;
  imageUri: string;
}) {
  const createdAt = new Date().toISOString();

  adminDeliveryLogs.unshift({
    orderId: payload.orderId,
    action: 'delivery-complete',
    elapsedSeconds: payload.elapsedSeconds,
    address: payload.address,
    imageUri: payload.imageUri,
    createdAt,
  });

  customerDeliveryProofs.unshift({
    orderId: payload.orderId,
    address: payload.address,
    imageUri: payload.imageUri,
    deliveredAt: createdAt,
  });
}

export function getAdminDeliveryLogs() {
  return [...adminDeliveryLogs];
}

export function getCustomerDeliveryProofs() {
  return [...customerDeliveryProofs];
}
