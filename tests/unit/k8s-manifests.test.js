import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("P1 - Kubernetes / K3s Manifest Topology & Validation", () => {
  const rootDir = path.resolve(process.cwd(), "deploy/k3s");
  const baseDir = path.join(rootDir, "base");
  const devDir = path.join(rootDir, "dev");
  const prodDir = path.join(rootDir, "production");

  it("ensures expected overlay directory structure exists", () => {
    expect(fs.existsSync(baseDir)).toBe(true);
    expect(fs.existsSync(devDir)).toBe(true);
    expect(fs.existsSync(prodDir)).toBe(true);
    expect(fs.existsSync(path.join(baseDir, "kustomization.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(devDir, "kustomization.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(prodDir, "kustomization.yaml"))).toBe(true);
  });

  it("validates all kustomization.yaml referenced resource files exist on disk", () => {
    for (const dir of [baseDir, devDir, prodDir]) {
      const kustomizeContent = fs.readFileSync(path.join(dir, "kustomization.yaml"), "utf8");
      const lines = kustomizeContent.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ") && !trimmed.startsWith("- ../")) {
          const fileRef = trimmed.slice(2).trim();
          const targetPath = path.join(dir, fileRef);
          expect(fs.existsSync(targetPath), `File ${fileRef} referenced in ${dir} must exist`).toBe(true);
        }
      }
    }
  });

  it("verifies development NATS topology uses singleton Deployment with exposed 8222 monitor port", () => {
    const devNatsContent = fs.readFileSync(path.join(devDir, "nats.yaml"), "utf8");

    // Must be a Deployment, NOT a StatefulSet
    expect(devNatsContent).toContain("kind: Deployment");
    expect(devNatsContent).not.toContain("kind: StatefulSet");

    // Must expose monitoring port 8222 in args
    expect(devNatsContent).toMatch(/- "-m"\s+- "8222"/);

    // Must define containerPort 8222
    expect(devNatsContent).toMatch(/containerPort:\s*8222/);

    // Probes must reference 8222 or monitor
    expect(devNatsContent).toMatch(/port:\s*(monitor|8222)/);
  });

  it("verifies production NATS topology uses 3-node HA StatefulSet with exposed 8222 monitor port", () => {
    const prodNatsContent = fs.readFileSync(path.join(prodDir, "nats-cluster.yaml"), "utf8");

    // Must be a StatefulSet with 3 replicas, NOT a Deployment
    expect(prodNatsContent).toContain("kind: StatefulSet");
    expect(prodNatsContent).not.toContain("kind: Deployment");
    expect(prodNatsContent).toContain("replicas: 3");

    // Must configure cluster routing and monitoring on 8222
    expect(prodNatsContent).toMatch(/- "-m"\s+- "8222"/);
    expect(prodNatsContent).toContain("--cluster_name");
    expect(prodNatsContent).toContain("monorally-nats-cluster");

    // Must define containerPort 8222 and cluster port 6222
    expect(prodNatsContent).toMatch(/containerPort:\s*8222/);
    expect(prodNatsContent).toMatch(/containerPort:\s*6222/);

    // Probes must reference 8222 or monitor
    expect(prodNatsContent).toMatch(/port:\s*(monitor|8222)/);
  });

  it("ensures no manifest directory ships conflicting controllers with duplicate NATS names", () => {
    // Neither dev nor production directory should define both Deployment and StatefulSet for NATS
    const devNatsContent = fs.readFileSync(path.join(devDir, "nats.yaml"), "utf8");
    const prodNatsContent = fs.readFileSync(path.join(prodDir, "nats-cluster.yaml"), "utf8");

    const devKinds = [...devNatsContent.matchAll(/kind:\s*(Deployment|StatefulSet)/g)].map((m) => m[1]);
    expect(devKinds).toContain("Deployment");
    expect(devKinds).not.toContain("StatefulSet");

    const prodKinds = [...prodNatsContent.matchAll(/kind:\s*(Deployment|StatefulSet)/g)].map((m) => m[1]);
    expect(prodKinds).toContain("StatefulSet");
    expect(prodKinds).not.toContain("Deployment");
  });
});
