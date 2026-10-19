import * as THREE from 'three';

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  tag?: string;
  runnable?: boolean;
  vaultable?: boolean;
}

export interface Trigger {
  id: string;
  center: THREE.Vector3;
  size: THREE.Vector3;
  kind: 'checkpoint' | 'finish';
  label: string;
  spawn?: THREE.Vector3;
}

export interface VaultTarget {
  box: Box;
  target: THREE.Vector3;
}
