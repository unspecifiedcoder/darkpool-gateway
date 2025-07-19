import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Simple floating particles
function FloatingParticles({ mousePosition }: { mousePosition: { x: number; y: number } }) {
  const pointsRef = useRef<THREE.Points>(null);
  
  const particlesPosition = useMemo(() => {
    const positions = new Float32Array(1500); // Reduced count
    for (let i = 0; i < 500; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }
    return positions;
  }, []);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.x = state.clock.elapsedTime * 0.02;
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.03;
      
      // React to mouse position
      pointsRef.current.position.x = mousePosition.x * 0.3;
      pointsRef.current.position.y = -mousePosition.y * 0.3;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={500}
          array={particlesPosition}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial 
        color="#00f6ff" 
        size={0.05} 
        transparent 
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

// Simplified gas giant
function GasGiant() {
  const planetRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z = state.clock.elapsedTime * 0.05;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z = state.clock.elapsedTime * 0.03;
    }
  });

  return (
    <group position={[8, -2, -15]}>
      {/* Main planet */}
      <mesh ref={planetRef}>
        <sphereGeometry args={[4, 32, 32]} />
        <meshPhongMaterial 
          color="#4a1a5c" 
          shininess={30}
          transparent 
          opacity={0.9}
        />
      </mesh>
      
      {/* Planetary rings */}
      <mesh ref={ring1Ref} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[6, 0.1, 8, 64]} />
        <meshBasicMaterial 
          color="#00f6ff" 
          transparent 
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      <mesh ref={ring2Ref} rotation={[Math.PI / 2.1, 0, 0]}>
        <torusGeometry args={[7, 0.05, 8, 64]} />
        <meshBasicMaterial 
          color="#ffffff" 
          transparent 
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// Simple floating geometry
function FloatingGeometry({ mousePosition }: { mousePosition: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.x = state.clock.elapsedTime * 0.01;
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.02;
      
      // Parallax effect
      groupRef.current.position.x = mousePosition.x * 0.1;
      groupRef.current.position.y = -mousePosition.y * 0.1;
    }
  });

  const geometries = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      id: i,
      position: [
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 8
      ] as [number, number, number],
      rotation: [Math.random() * Math.PI, Math.random() * Math.PI, 0] as [number, number, number],
      scale: 0.1 + Math.random() * 0.15,
      color: Math.random() > 0.5 ? "#00f6ff" : "#00ff87"
    }));
  }, []);

  return (
    <group ref={groupRef}>
      {geometries.map((geom) => (
        <mesh 
          key={geom.id}
          position={geom.position}
          rotation={geom.rotation}
          scale={geom.scale}
        >
          <octahedronGeometry args={[1]} />
          <meshBasicMaterial 
            color={geom.color} 
            transparent 
            opacity={0.6}
            wireframe
          />
        </mesh>
      ))}
    </group>
  );
}

// Error boundary for Three.js components
function Scene({ mousePosition }: { mousePosition: { x: number; y: number } }) {
  return (
    <Suspense fallback={null}>
      {/* Ambient lighting */}
      <ambientLight intensity={0.2} color="#00f6ff" />
      
      {/* Directional lighting */}
      <directionalLight 
        position={[10, 10, 5]} 
        intensity={0.5} 
        color="#ffffff" 
      />
      
      {/* Point light from planet */}
      <pointLight 
        position={[8, -2, -15]} 
        intensity={0.3} 
        color="#4a1a5c" 
        distance={30}
      />

      {/* 3D Elements */}
      <GasGiant />
      <FloatingParticles mousePosition={mousePosition} />
      <FloatingGeometry mousePosition={mousePosition} />
    </Suspense>
  );
}

interface CosmicBackgroundProps {
  mousePosition: { x: number; y: number };
}

const CosmicBackground: React.FC<CosmicBackgroundProps> = React.memo(({ mousePosition }) => {
  return (
    <div className="fixed inset-0 z-0">
      {/* <div>HIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII</div> */}
      <Canvas
        camera={{ 
          position: [0, 0, 10], 
          fov: 60,
          near: 0.1,
          far: 1000
        }}
        style={{ background: 'transparent' }}
        gl={{ 
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: false
        }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
        onError={(error) => {
          console.warn('Three.js Canvas Error:', error);
        }}
      >
        <Scene mousePosition={mousePosition} />
      </Canvas>
    </div>
  );
});

CosmicBackground.displayName = 'CosmicBackground';

export default CosmicBackground;