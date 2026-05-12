/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Configuración base para proyectos TypeScript con Jest
  preset: 'ts-jest', 
  
  // Entorno de ejecución de Node.js (necesario para el backend)
  testEnvironment: 'node', 
  
  // Rutas donde buscar los archivos fuente y de prueba
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  
  // Expresiones regulares para identificar archivos de prueba (archivos terminados en .spec.ts o .test.ts)
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.ts$',

  // Configuración de Módulos (para resolver rutas internas de NestJS)
  moduleNameMapper: {
    // Si tienes aliases definidos en tsconfig.json, se deben mapear aquí
  },
  
  // CLAVE: Definición explícita del transformador para manejar TypeScript
  transform: {
    // Usar ts-jest para todos los archivos .ts
    '^.+\\.ts$': [
      'ts-jest', 
      {
        // Indica a ts-jest que use el archivo de configuración de TypeScript del proyecto actual
        tsconfig: './tsconfig.json', 
      },
    ],
  },
  
  // Extensiones de archivos que debe buscar
  moduleFileExtensions: ['js', 'json', 'ts'],

  // Carpetas a ignorar para la transformación y ejecución
  testPathIgnorePatterns: [
    '/node_modules/',
    '/lib/' // Carpeta de salida de la compilación
  ],
  
  // Configuración de Cobertura de Código (Opcional, pero recomendado en la WBS)
  collectCoverageFrom: [
    'src/**/*.{js,ts}'
  ],
  coverageDirectory: 'coverage',
};



